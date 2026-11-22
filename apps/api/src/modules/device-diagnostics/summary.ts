import type { Database } from "@iot/database";
import type {
  DiagnosticOptions,
  DiagnosticSummaryRow,
  Reading,
} from "@iot/contracts";
import { analyzeDiagnostics } from "./analysis.js";

export async function diagnosticSummary(
  db: Database,
  options: DiagnosticOptions,
) {
  const to = new Date();
  const from = new Date(
    to.getTime() - Math.max(60, options.flat_minutes) * 60000,
  );
  const devices = await db.device.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      name: true,
      sourceKind: true,
      lastSeenAt: true,
      reportingIntervalMs: true,
      roomAssignment: {
        select: {
          room: {
            select: {
              name: true,
              archivedAt: true,
              area: { select: { archivedAt: true } },
            },
          },
        },
      },
      rollups: {
        where: {
          timeBasis: "received",
          bucketStart: {
            gte: new Date(Math.floor(from.getTime() / 3600000) * 3600000),
            lt: to,
          },
        },
        select: { deviceId: true },
        take: 1,
      },
      configs: {
        select: { version: true, config: true },
        orderBy: { version: "desc" },
        take: 32,
      },
      statuses: {
        where: { effectiveAt: { gte: from, lte: to } },
        orderBy: { effectiveAt: "desc" },
        take: 1,
      },
    },
  });
  // Limit each index scan independently, even for stations reporting many times per second.
  const records = await db.$queryRaw<
    { device_id: string; id: bigint; received_at: Date; payload: Reading }[]
  >`
    SELECT d.id AS device_id, r.id, r.received_at, r.payload FROM devices d
    CROSS JOIN LATERAL (
      SELECT id, received_at, payload FROM sensor_readings
      WHERE device_id = d.id AND received_at >= ${from} AND received_at < ${to}
      ORDER BY received_at DESC, id DESC LIMIT 1201
    ) r WHERE d.archived_at IS NULL ORDER BY d.id, r.received_at, r.id`;
  const byDevice = new Map<string, typeof records>();
  for (const r of records) {
    const rows = byDevice.get(r.device_id) ?? [];
    rows.push(r);
    byDevice.set(r.device_id, rows);
  }
  return devices
    .map((device): DiagnosticSummaryRow => {
      const raw = byDevice.get(device.id) ?? [];
      const room = device.roomAssignment?.room;
      const intervals = Object.fromEntries(
        device.configs.map((c) => [
          c.version,
          (c.config as { reporting_interval_ms: number }).reporting_interval_ms,
        ]),
      );
      const limited =
        device.rollups.length > 0 ||
        raw.length > 1200 ||
        raw.some((r) => !intervals[r.payload.config_version]);
      const readings = raw.map((r) => ({
        id: String(r.id),
        received_at: r.received_at.toISOString(),
        payload: r.payload,
      }));
      const offline =
        device.lastSeenAt &&
        to.getTime() - device.lastSeenAt.getTime() >=
          Math.max(30000, device.reportingIntervalMs * 3);
      const notices = limited
        ? []
        : analyzeDiagnostics(
            {
              readings,
              intervals,
              interval_ms: device.reportingIntervalMs,
              baseline: null,
              statuses: [],
            },
            { ...options, from: from.toISOString(), to: to.toISOString() },
          ).notices;
      if (offline) {
        notices.splice(0, notices.length, {
          id: "offline",
          level: "check",
          title: "Mất kết nối",
          evidence:
            "Liên lạc lần cuối lúc " +
            device.lastSeenAt!.toLocaleTimeString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
            }) +
            " (giờ Việt Nam).",
          action: "Kiểm tra nguồn điện và kết nối mạng của trạm.",
        });
      } else if (limited) {
        notices.push({
          id: "partial",
          level: "info",
          title: "Chưa đủ dữ liệu để kết luận",
          evidence: "Lịch sử gần đây vượt giới hạn hoặc thiếu cấu hình.",
          action: "Mở chi tiết và thu hẹp khoảng kiểm tra.",
        });
      }
      notices.sort((a, b) => priority(a.id) - priority(b.id));
      const status = device.statuses;
      const recovered =
        !notices.length &&
        status[0]?.newStatus === "online" &&
        status[0].previousStatus === "offline";
      return {
        device_id: device.id,
        name: device.name,
        room:
          room && !room.archivedAt && !room.area.archivedAt ? room.name : null,
        source_kind: device.sourceKind,
        last_seen_at: device.lastSeenAt?.toISOString() ?? null,
        recovered_at: recovered ? status[0]!.effectiveAt.toISOString() : null,
        notices,
      };
    })
    .sort(
      (a, b) =>
        priority(a.notices[0]?.id) - priority(b.notices[0]?.id) ||
        a.name.localeCompare(b.name, "vi"),
    );
}
function priority(id?: string) {
  if (!id) return 5;
  if (id === "offline" || id === "silent") return 0;
  if (id.startsWith("invalid-") || id.startsWith("stale-")) return 1;
  if (id === "partial" || id === "warming" || id === "empty") return 3;
  return 2;
}
