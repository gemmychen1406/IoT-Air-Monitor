import { gasLevel, type AnalyticsView, type GasLevel } from "@iot/contracts";
import type { RangeInput, ReportData } from "./types.js";
import { coverage, formatValue } from "./utils.js";

export type Tone = "good" | "watch" | "alert" | "unknown";
export type SummaryItem = {
  id: string;
  title: string;
  text: string;
  tone: Tone;
};
export type ReportSummary = {
  headline: string;
  tone: Tone;
  items: SummaryItem[];
  advice: string[];
};

/** Khoảng tham chiếu chung cho phòng ở; không phải tiêu chuẩn y tế. */
export const TEMPERATURE_COMFORT = [22, 28] as const;
export const HUMIDITY_COMFORT = [40, 70] as const;

const hasData = (data?: AnalyticsView) => (data?.summary.valid_count ?? 0) > 0;
const lower = (text: string) => text.toLowerCase();

function temperatureItem(data?: AnalyticsView): SummaryItem {
  const id = "temperature_c";
  const title = "Nhiệt độ";
  const { average, min, max } = data?.summary ?? {};
  if (!hasData(data) || average == null)
    return {
      id,
      title,
      tone: "unknown",
      text: "Chưa có số đo nhiệt độ hợp lệ trong kỳ này.",
    };
  const [low, high] = TEMPERATURE_COMFORT;
  let label = "nằm trong khoảng dễ chịu";
  let tone: Tone = "good";
  if (average < 18) [label, tone] = ["khá lạnh", "watch"];
  else if (average < low) [label, tone] = ["hơi mát", "watch"];
  else if (average > 32) [label, tone] = ["nóng", "alert"];
  else if (average > high) [label, tone] = ["hơi nóng", "watch"];
  let text = `Nhiệt độ trung bình ${formatValue(average, data!.unit)}, ${label}.`;
  if (min != null && max != null) {
    text += ` Thấp nhất ${formatValue(min, data!.unit)}, cao nhất ${formatValue(max, data!.unit)}.`;
    if (max - min >= 8) text += " Nhiệt độ dao động khá lớn trong kỳ.";
  }
  return { id, title, tone, text };
}

function humidityItem(data?: AnalyticsView): SummaryItem {
  const id = "humidity_pct";
  const title = "Độ ẩm";
  const { average, min, max } = data?.summary ?? {};
  if (!hasData(data) || average == null)
    return {
      id,
      title,
      tone: "unknown",
      text: "Chưa có số đo độ ẩm hợp lệ trong kỳ này.",
    };
  const [low, high] = HUMIDITY_COMFORT;
  let label = "ở mức dễ chịu";
  let tone: Tone = "good";
  if (average < low) [label, tone] = ["khá khô", "watch"];
  else if (average > 80)
    [label, tone] = ["rất ẩm, dễ gây cảm giác bí và ẩm mốc", "alert"];
  else if (average > high) [label, tone] = ["hơi ẩm", "watch"];
  let text = `Độ ẩm trung bình ${formatValue(average, data!.unit)}, ${label}.`;
  if (min != null && max != null)
    text += ` Thấp nhất ${formatValue(min, data!.unit)}, cao nhất ${formatValue(max, data!.unit)}.`;
  return { id, title, tone, text };
}

type GasResult = { item: SummaryItem; peak: GasLevel | null };

function gasItem(
  metric: "mq2_adc" | "mq7_adc",
  data?: AnalyticsView,
): GasResult {
  const kind = metric === "mq2_adc" ? "mq2" : "mq7";
  const title =
    metric === "mq2_adc" ? "Khí gas / khói (MQ-2)" : "Khí CO (MQ-7)";
  const { average, max } = data?.summary ?? {};
  if (!hasData(data) || average == null || max == null || !data?.adc_bits)
    return {
      peak: null,
      item: {
        id: metric,
        title,
        tone: "unknown",
        text: "Chưa đủ dữ liệu hợp lệ để đánh giá.",
      },
    };
  const input = { kind, adc_bits: data.adc_bits, quality: "valid" } as const;
  const avgLevel = gasLevel({ ...input, adc_raw: average });
  const peak = gasLevel({ ...input, adc_raw: max });
  const rank = peak.rank ?? 0;
  let text = `Phần lớn thời gian ở mức ${lower(avgLevel.label)}; đỉnh cao nhất trong kỳ chạm mức ${lower(peak.label)}.`;
  if (rank >= 2)
    text += " Nên xem lại thời điểm này trên biểu đồ và trong danh sách sự cố.";
  else if (rank === 1)
    text += " Có lúc tín hiệu tăng nhẹ, nên tiếp tục theo dõi.";
  text +=
    " (Mức này là ước tính từ tín hiệu cảm biến, không phải nồng độ thực.)";
  const tone: Tone = rank >= 2 ? "alert" : rank === 1 ? "watch" : "good";
  return { peak, item: { id: metric, title, tone, text } };
}

const CONDITION_LABEL = {
  gas: "khí gas/khói",
  co: "khí CO",
  flame: "lửa",
} as const;

function incidentItem(report: ReportData): SummaryItem {
  const id = "incidents";
  const title = "Sự cố";
  const list = report.incidents;
  if (!list.length)
    return {
      id,
      title,
      tone: "good",
      text: "Hệ thống cảnh báo không ghi nhận sự cố nào trong kỳ này.",
    };
  const critical = list.filter((i) => i.severity === "critical").length;
  const active = list.filter((i) => i.status === "active").length;
  const counts = new Map<string, number>();
  for (const incident of list)
    counts.set(incident.condition, (counts.get(incident.condition) ?? 0) + 1);
  const kinds = [...counts]
    .map(
      ([key, n]) =>
        `${CONDITION_LABEL[key as keyof typeof CONDITION_LABEL] ?? key} (${n})`,
    )
    .join(", ");
  let text = `Ghi nhận ${list.length}${report.incidentsComplete ? "" : "+"} sự cố: ${kinds}.`;
  if (critical) text += ` Trong đó ${critical} sự cố mức nghiêm trọng.`;
  if (active) text += ` Hiện còn ${active} sự cố đang diễn ra.`;
  return { id, title, tone: critical || active ? "alert" : "watch", text };
}

export type Reliability = {
  level: "good" | "fair" | "low" | "none";
  percent: number | null;
};

export function dataReliability(
  analytics: ReportData["analytics"],
  range: RangeInput,
): Reliability {
  const values = (Object.values(analytics) as (AnalyticsView | undefined)[])
    .filter(hasData)
    .map((data) => coverage(data, range).percent)
    .filter((value): value is number => value !== null);
  if (!values.length) return { level: "none", percent: null };
  const percent = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    level: percent >= 80 ? "good" : percent >= 50 ? "fair" : "low",
    percent,
  };
}

function reliabilityItem(
  report: ReportData,
  reliability: Reliability,
): SummaryItem {
  const id = "data";
  const title = "Độ tin cậy của dữ liệu";
  if (reliability.level === "none")
    return {
      id,
      title,
      tone: "unknown",
      text: "Không có số đo hợp lệ nào trong khoảng thời gian này. Hãy kiểm tra thiết bị có đang bật và gửi dữ liệu không.",
    };
  const percent = reliability.percent!.toFixed(0);
  let valid = 0;
  let invalid = 0;
  for (const data of Object.values(report.analytics)) {
    valid += data?.summary.valid_count ?? 0;
    invalid += data?.summary.invalid_count ?? 0;
  }
  const rejected = valid + invalid ? (invalid / (valid + invalid)) * 100 : 0;
  let text =
    reliability.level === "good"
      ? `Thiết bị gửi dữ liệu khá đều: khoảng ${percent}% thời gian trong kỳ có số đo.`
      : reliability.level === "fair"
        ? `Dữ liệu có một số khoảng trống: chỉ khoảng ${percent}% thời gian trong kỳ có số đo, nên nhận xét chỉ mang tính tham khảo.`
        : `Dữ liệu thiếu nhiều: chỉ khoảng ${percent}% thời gian trong kỳ có số đo, nên chưa thể kết luận chắc chắn.`;
  if (rejected >= 10)
    text += ` Khoảng ${rejected.toFixed(0)}% số đo bị loại vì không hợp lệ.`;
  return {
    id,
    title,
    tone: reliability.level === "good" ? "good" : "watch",
    text,
  };
}

export function buildSummary(report: ReportData): ReportSummary {
  const { analytics } = report;
  const reliability = dataReliability(analytics, report.range);
  const gas = gasItem("mq2_adc", analytics.mq2_adc);
  const co = gasItem("mq7_adc", analytics.mq7_adc);
  const incidents = incidentItem(report);
  const measures: SummaryItem[] = [
    temperatureItem(analytics.temperature_c),
    humidityItem(analytics.humidity_pct),
    gas.item,
    co.item,
  ];
  const items = [reliabilityItem(report, reliability), ...measures, incidents];

  const critical = report.incidents.some((i) => i.severity === "critical");
  const active = report.incidents.some((i) => i.status === "active");
  const reasons: string[] = [];
  if (critical) reasons.push("có sự cố mức nghiêm trọng");
  if (active) reasons.push("còn sự cố đang diễn ra");
  if ((gas.peak?.rank ?? 0) >= 2)
    reasons.push("tín hiệu khí gas/khói chạm mức cảnh báo trở lên");
  if ((co.peak?.rank ?? 0) >= 2)
    reasons.push("tín hiệu khí CO chạm mức cảnh báo trở lên");

  let headline: string;
  let tone: Tone;
  if (reliability.level === "none") {
    headline = "Chưa đủ dữ liệu để đánh giá khoảng thời gian này.";
    tone = "unknown";
  } else if (reasons.length) {
    headline = `Cần chú ý: ${reasons.join("; ")}.`;
    tone = "alert";
  } else if (reliability.level === "low") {
    headline =
      "Dữ liệu thiếu nhiều nên đánh giá dưới đây chỉ mang tính tham khảo.";
    tone = "watch";
  } else {
    const watching = measures.filter(
      (i) => i.tone === "watch" || i.tone === "alert",
    );
    if (watching.length) {
      headline = `Nhìn chung chưa có dấu hiệu nguy hiểm, nhưng cần theo dõi: ${watching.map((i) => lower(i.title.replace(/ \(.*\)$/, ""))).join(", ")}.`;
      tone = "watch";
    } else {
      headline =
        "Trong khoảng thời gian này, chưa thấy dấu hiệu bất thường rõ ràng trong dữ liệu thu được.";
      tone = "good";
    }
  }

  const advice: string[] = [];
  const temperature = analytics.temperature_c?.summary.average;
  const humidity = analytics.humidity_pct?.summary.average;
  if (
    temperature != null &&
    hasData(analytics.temperature_c) &&
    temperature > TEMPERATURE_COMFORT[1]
  )
    advice.push("Nhiệt độ khá cao: cân nhắc mở cửa, bật quạt hoặc điều hòa.");
  if (humidity != null && hasData(analytics.humidity_pct)) {
    if (humidity > HUMIDITY_COMFORT[1])
      advice.push("Độ ẩm cao: nên thông gió hoặc dùng máy hút ẩm.");
    else if (humidity < HUMIDITY_COMFORT[0])
      advice.push("Độ ẩm thấp: có thể dùng máy tạo ẩm nếu thấy khô.");
  }
  for (const peak of [gas.peak, co.peak])
    if (peak && (peak.rank ?? 0) >= 1 && !advice.includes(peak.advice))
      advice.push(peak.advice);
  if (reliability.level === "low" || reliability.level === "fair")
    advice.push(
      "Dữ liệu còn thiếu: kiểm tra nguồn điện và kết nối mạng của thiết bị.",
    );
  if (!advice.length)
    advice.push("Chưa có gợi ý đặc biệt. Tiếp tục theo dõi định kỳ.");

  return { headline, tone, items, advice };
}
