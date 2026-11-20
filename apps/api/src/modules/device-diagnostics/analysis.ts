import type {
  DiagnosticInput,
  DiagnosticQuery,
  DiagnosticReport,
  ReadingView,
} from "@iot/contracts";

const names = {
  temperature: "Nhiệt độ",
  humidity: "Độ ẩm",
  mq2: "Khí MQ-2",
  mq7: "CO MQ-7",
};
type Metric = keyof typeof names;
function value(row: ReadingView, metric: Metric): number | null {
  const s = row.payload.sensors;
  const sensor =
    metric === "temperature" || metric === "humidity" ? s.dht11 : s[metric];
  if (sensor.age_ms > 30000) return null;
  if (metric === "temperature" || metric === "humidity")
    return s.dht11.quality === "valid"
      ? metric === "temperature"
        ? s.dht11.temperature_c
        : s.dht11.humidity_pct
      : null;
  const gas = s[metric];
  return ["valid", "uncalibrated"].includes(gas.quality) && gas.adc_raw !== null
    ? (gas.adc_raw / (2 ** gas.adc_bits - 1)) * 100
    : null;
}
function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!;
}
function compareRows(a: ReadingView, b: ReadingView) {
  for (const key of ["boot_counter", "seq"] as const) {
    const diff = BigInt(a.payload[key]) - BigInt(b.payload[key]);
    if (diff) return diff < 0n ? -1 : 1;
  }
  return a.payload.boot_id.localeCompare(b.payload.boot_id);
}

/** Pure, read-only analysis. Sequence/uptime determine sample order, not packet arrival. */
export function analyzeDiagnostics(
  input: DiagnosticInput,
  query: DiagnosticQuery,
): Omit<DiagnosticReport, "source_kind" | "completeness"> {
  const from = Date.parse(query.from),
    to = Date.parse(query.to);
  const rows = [...input.readings].sort(compareRows);
  const quality = (["dht11", "mq2", "mq7", "flame"] as const).map((sensor) => {
    const counts: Record<string, number> = {
      valid: 0,
      invalid: 0,
      warming_up: 0,
      heating: 0,
      uncalibrated: 0,
    };
    for (const row of rows) counts[row.payload.sensors[sensor].quality]!++;
    return {
      sensor,
      counts,
      total: rows.length,
      stale: rows.filter((r) => r.payload.sensors[sensor].age_ms > 30000)
        .length,
    };
  });
  const events: DiagnosticReport["events"] = [];
  const sessions: DiagnosticReport["sessions"] = [];
  const firmwareChanges: DiagnosticReport["firmware_changes"] = [];
  const clock = { synced: 0, unsynced: 0, backwards: 0, future: 0 };
  const intervals: number[] = [],
    delays: number[] = [];
  const sessionById = new Map<string, DiagnosticReport["sessions"][number]>();
  const flatStarts = new Map<Metric, ReadingView>();
  let previous: ReadingView | undefined;
  let firmware: string | undefined;
  const expectedInterval = (r: ReadingView) =>
    input.intervals[r.payload.config_version] ?? input.interval_ms;
  for (const row of rows) {
    const r = row.payload;
    clock[r.time_quality === "synced" ? "synced" : "unsynced"]++;
    if (r.time_quality === "synced" && r.sampled_at) {
      const delay = Date.parse(row.received_at) - Date.parse(r.sampled_at);
      if (delay >= 0) delays.push(delay);
      else clock.future++;
    }
    let session = sessionById.get(r.boot_id);
    if (!session) {
      session = {
        boot_id: r.boot_id,
        boot_counter: r.boot_counter,
        first_at: row.received_at,
        last_at: row.received_at,
        samples: 0,
        firmware: [],
      };
      sessionById.set(r.boot_id, session);
      sessions.push(session);
    }
    session.samples++;
    if (row.received_at < session.first_at) session.first_at = row.received_at;
    if (row.received_at > session.last_at) session.last_at = row.received_at;
    if (!session.firmware.includes(r.firmware_version))
      session.firmware.push(r.firmware_version);
    if (firmware !== undefined && firmware !== r.firmware_version)
      firmwareChanges.push({
        at: row.received_at,
        previous: firmware,
        current: r.firmware_version,
      });
    firmware = r.firmware_version;
    const sameBoot = previous?.payload.boot_id === r.boot_id;
    const delta = sameBoot
      ? Number(BigInt(r.uptime_ms) - BigInt(previous!.payload.uptime_ms))
      : 0;
    const expected = Math.max(
      expectedInterval(row),
      previous ? expectedInterval(previous) : 0,
    );
    const contiguous =
      sameBoot && delta > 0 && delta <= expected * query.gap_multiplier;
    if (sameBoot && delta > 0) intervals.push(delta);
    if (sameBoot && delta > expected * query.gap_multiplier)
      events.push({
        kind: "gap",
        sensor: "device",
        from: previous!.received_at,
        to: row.received_at,
        detail: `Hai mẫu liên tiếp trong cùng phiên cách nhau ${Math.round(delta / 1000)} giây theo thời gian hoạt động; chu kỳ tham chiếu ${expected / 1000} giây.`,
      });
    if (
      sameBoot &&
      previous!.payload.sampled_at &&
      r.sampled_at &&
      Date.parse(r.sampled_at) < Date.parse(previous!.payload.sampled_at!)
    ) {
      clock.backwards++;
      events.push({
        kind: "clock",
        sensor: "device",
        from: previous!.received_at,
        to: row.received_at,
        detail:
          "Thời gian đo đi lùi khi thứ tự mẫu tăng trong cùng phiên khởi động.",
      });
    }
    for (const metric of Object.keys(names) as Metric[]) {
      const current = value(row, metric),
        old = previous ? value(previous, metric) : null;
      const sameProfile =
        metric === "temperature" ||
        metric === "humidity" ||
        !previous ||
        previous.payload.sensors[metric].adc_bits ===
          r.sensors[metric].adc_bits;
      const usable =
        contiguous && sameProfile && current !== null && old !== null;
      const tolerance =
        metric === "temperature" ? 0.05 : metric === "humidity" ? 0.2 : 0.05;
      const anchor = flatStarts.get(metric);
      const anchorValue = anchor ? value(anchor, metric) : old;
      if (
        usable &&
        Math.abs(current - old) <= tolerance &&
        anchorValue !== null &&
        Math.abs(current - anchorValue) <= tolerance
      ) {
        if (!flatStarts.has(metric)) flatStarts.set(metric, previous!);
      } else {
        flushFlat(metric, previous);
        flatStarts.delete(metric);
      }
      const threshold =
        metric === "temperature"
          ? query.temperature_jump
          : metric === "humidity"
            ? query.humidity_jump
            : query.gas_jump_pct;
      // Compare neighbouring, ready readings only over a short window. A long gap is not a spike.
      if (usable && delta <= 120000 && Math.abs(current - old) >= threshold)
        events.push({
          kind: "jump",
          sensor: metric,
          from: previous!.received_at,
          to: row.received_at,
          detail: `${names[metric]} đổi từ ${old.toFixed(1)} sang ${current.toFixed(1)} ${metric === "temperature" ? "°C" : metric === "humidity" ? "%RH" : "% toàn thang ADC"} trong ${Math.round(delta / 1000)} giây. Đây là dấu hiệu cần kiểm tra.`,
        });
    }
    previous = row;
  }
  function flushFlat(metric: Metric, end?: ReadingView) {
    const start = flatStarts.get(metric);
    if (!start || !end || start.payload.boot_id !== end.payload.boot_id) return;
    const duration = Number(
      BigInt(end.payload.uptime_ms) - BigInt(start.payload.uptime_ms),
    );
    if (duration >= query.flat_minutes * 60000)
      events.push({
        kind: "flat",
        sensor: metric,
        from: start.received_at,
        to: end.received_at,
        detail: `${names[metric]} gần như không đổi trong ${Math.round(duration / 60000)} phút. Môi trường ổn định cũng có thể tạo ra dấu hiệu này.`,
      });
  }
  for (const metric of Object.keys(names) as Metric[])
    flushFlat(metric, previous);
  // Receipt gaps complement uptime gaps and cover silence at the end of the requested window.
  const received = [...rows].sort((a, b) =>
    a.received_at.localeCompare(b.received_at),
  );
  const existingGaps = new Set(
    events.filter((e) => e.kind === "gap").map((e) => `${e.from}/${e.to}`),
  );
  for (let i = 1; i < received.length; i++) {
    const a = received[i - 1]!,
      b = received[i]!;
    const delta = Date.parse(b.received_at) - Date.parse(a.received_at);
    if (
      delta >
        Math.max(expectedInterval(a), expectedInterval(b)) *
          query.gap_multiplier &&
      !existingGaps.has(`${a.received_at}/${b.received_at}`)
    )
      events.push({
        kind: "gap",
        sensor: "device",
        from: a.received_at,
        to: b.received_at,
        detail: `Server không nhận mẫu trong ${Math.round(delta / 1000)} giây giữa hai lần nhận. Có thể do mất kết nối, tạm dừng hoặc gửi gộp.`,
      });
  }
  const first = received[0];
  const boundary = Math.max(
    from,
    input.created_at ? Date.parse(input.created_at) : from,
  );
  if (
    first &&
    Date.parse(first.received_at) - boundary >
      expectedInterval(first) * query.gap_multiplier
  )
    events.push({
      kind: "gap",
      sensor: "device",
      from: new Date(boundary).toISOString(),
      to: first.received_at,
      detail:
        "Chưa nhận mẫu ở đầu khoảng chọn (sau thời điểm đăng ký thiết bị). Kiểm tra thêm lịch sử kết nối; không kết luận cảm biến bị hỏng.",
    });
  const last = received.at(-1);
  if (
    last &&
    to - Date.parse(last.received_at) >
      expectedInterval(last) * query.gap_multiplier
  )
    events.push({
      kind: "gap",
      sensor: "device",
      from: last.received_at,
      to: query.to,
      detail: `Không có mẫu mới trong ${Math.round((to - Date.parse(last.received_at)) / 60000)} phút cuối khoảng chọn. Kết nối vẫn có thể còn hoạt động nếu thiết bị chỉ gửi heartbeat.`,
    });
  let offlineMs = 0,
    unknownMs = 0,
    disconnects = 0;
  let cursor = from,
    state = input.baseline?.status ?? "unknown";
  for (const item of [...input.statuses].sort((a, b) =>
    a.effective_at.localeCompare(b.effective_at),
  )) {
    const at = Math.max(from, Math.min(to, Date.parse(item.effective_at)));
    if (at < cursor) continue;
    if (state === "offline") offlineMs += at - cursor;
    if (state !== "online" && state !== "offline") unknownMs += at - cursor;
    if (item.status === "offline" && state !== "offline") disconnects++;
    state = item.status;
    cursor = at;
  }
  if (state === "offline") offlineMs += to - cursor;
  if (state !== "online" && state !== "offline") unknownMs += to - cursor;
  const notices: DiagnosticReport["notices"] = [];
  const recent = received.filter(
    (r) => Date.parse(r.received_at) >= to - 5 * 60000,
  );
  const latest = received.at(-1);
  if (!latest)
    notices.push({
      id: "empty",
      level: "info",
      title: "Chưa có số đo trong khoảng này",
      evidence: "Không nhận được mẫu gốc để kiểm tra.",
      action:
        "Thử khoảng thời gian khác. Nếu thiết bị mới lắp, hãy kiểm tra nguồn điện và kết nối Wi‑Fi.",
    });
  else if (
    to - Date.parse(latest.received_at) >
    Math.max(60000, expectedInterval(latest) * query.gap_multiplier)
  )
    notices.push({
      id: "silent",
      level: "check",
      title: "Đã lâu chưa có số đo mới",
      evidence: `Mẫu cuối cách cuối khoảng chọn ${Math.round((to - Date.parse(latest.received_at)) / 60000)} phút.`,
      action:
        "Kiểm tra nguồn điện và Wi‑Fi của thiết bị. Sau đó bấm Cập nhật để xem số đo đã trở lại chưa.",
    });
  for (const sensor of ["dht11", "mq2", "mq7", "flame"] as const) {
    const bad = recent.filter(
      (r) => r.payload.sensors[sensor].quality === "invalid",
    ).length;
    const label = {
      dht11: "nhiệt độ và độ ẩm",
      mq2: "khí MQ-2",
      mq7: "CO MQ-7",
      flame: "lửa",
    }[sensor];
    if (
      latest &&
      to - Date.parse(latest.received_at) < 60000 &&
      latest.payload.sensors[sensor].age_ms > 30000
    )
      notices.push({
        id: `stale-${sensor}`,
        level: "check",
        title: `Số đo ${label} trong gói đã cũ`,
        evidence: `Thiết bị báo số đo đã ${Math.round(latest.payload.sensors[sensor].age_ms / 1000)} giây tuổi trước khi gửi.`,
        action:
          "Thiết bị vẫn gửi dữ liệu nhưng có thể chưa đọc được mẫu mới. Hãy kiểm tra cảm biến và chờ số đo mới trước khi đánh giá.",
      });
    if (
      bad >= 3 &&
      recent.length &&
      bad / recent.length >= 0.3 &&
      latest?.payload.sensors[sensor].quality === "invalid"
    )
      notices.push({
        id: `invalid-${sensor}`,
        level: "check",
        title: `Cần kiểm tra cảm biến ${label}`,
        evidence: `${bad}/${recent.length} mẫu trong 5 phút cuối báo lỗi và mẫu mới nhất vẫn báo lỗi.`,
        action:
          "Kiểm tra thiết bị có bị che, ẩm hoặc lỏng kết nối không. Đọc hướng dẫn của thiết bị trước khi tháo hoặc chỉnh dây.",
      });
  }
  if (
    recent.length &&
    latest?.payload.time_quality === "unsynced" &&
    recent.filter((r) => r.payload.time_quality === "unsynced").length /
      recent.length >
      0.5
  )
    notices.push({
      id: "time",
      level: "check",
      title: "Thiết bị chưa đồng bộ giờ",
      evidence: "Đa số mẫu trong 5 phút cuối chưa có thời gian đo đã đồng bộ.",
      action:
        "Kiểm tra kết nối Internet của thiết bị và chờ đồng bộ giờ. Tạm đọc lịch sử theo thời gian server nhận.",
    });
  const recentBoots = new Set(
    received
      .filter((r) => Date.parse(r.received_at) >= to - 3600000)
      .map((r) => r.payload.boot_id),
  );
  if (recentBoots.size - 1 >= query.reboot_threshold)
    notices.push({
      id: "reboot",
      level: "check",
      title: "Thiết bị khởi động lại nhiều lần",
      evidence: `Quan sát ít nhất ${recentBoots.size - 1} lần đổi phiên trong giờ cuối.`,
      action:
        "Kiểm tra ổ cắm, bộ nguồn và dây cấp điện có lỏng không. Nếu vẫn lặp lại, nhờ người phụ trách thiết bị kiểm tra.",
    });
  if (
    latest &&
    to - Date.parse(latest.received_at) < 60000 &&
    ["warming_up", "heating"].includes(latest.payload.sensors.mq7.quality)
  )
    notices.push({
      id: "warming",
      level: "info",
      title: "Cảm biến CO đang chuẩn bị đo",
      evidence: "Mẫu gần nhất đang khởi động hoặc gia nhiệt.",
      action:
        "Chờ cảm biến hoàn tất chu kỳ theo hướng dẫn thiết bị; lúc này chưa có số đo CO sẵn sàng để đánh giá.",
    });
  const currentSignalEvent = [...events]
    .reverse()
    .find(
      (e) =>
        ["flat", "jump"].includes(e.kind) &&
        e.to === latest?.received_at &&
        to - Date.parse(e.to) < 60000,
    );
  if (currentSignalEvent)
    notices.push({
      id: "signal",
      level: "check",
      title: `${names[currentSignalEvent.sensor as Metric]} có dấu hiệu cần xem lại`,
      evidence: currentSignalEvent.detail,
      action:
        currentSignalEvent.kind === "flat"
          ? "Xem cảm biến có bị che hoặc đặt sát nguồn nhiệt không. Môi trường ổn định cũng có thể làm số đo ít thay đổi; hãy đối chiếu trước khi chỉnh thiết bị."
          : "Xem quanh vị trí cảm biến có thay đổi thật như bếp, hơi nước hoặc nguồn nhiệt không. Nếu không có, hãy kiểm tra cách đặt và kết nối cảm biến.",
    });
  return {
    from: query.from,
    to: query.to,
    generated_at: new Date().toISOString(),
    count: rows.length,
    quality,
    events: events.sort((a, b) => b.to.localeCompare(a.to)).slice(0, 200),
    event_count: events.length,
    connection: {
      offline_ms: offlineMs,
      unknown_ms: unknownMs,
      disconnects,
      interval_median_ms: percentile(intervals, 0.5),
      delay_median_ms: percentile(delays, 0.5),
      delay_p95_ms: percentile(delays, 0.95),
      delay_count: delays.length,
    },
    clock,
    sessions: sessions.slice(-200),
    session_count: sessions.length,
    firmware_changes: firmwareChanges.slice(-200),
    firmware_change_count: firmwareChanges.length,
    reboots_observed: Math.max(0, sessions.length - 1),
    notices,
  };
}
