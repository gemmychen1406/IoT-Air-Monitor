/**
 * Quy đổi tín hiệu ADC thô của MQ-2 / MQ-7 thành mức cảnh báo dễ hiểu (0–3).
 *
 * Đây là mức ƯỚC TÍNH theo tỷ lệ ADC trên thang đo đầy đủ, KHÔNG phải ppm.
 * Ngưỡng mặc định chỉ là điểm khởi đầu; mỗi module MQ có mức nền khác nhau nên
 * cần chỉnh lại theo thiết bị thật (xem GAS_LEVEL_THRESHOLDS).
 */
export type GasSensorKind = "mq2" | "mq7";
export type GasLevelId = "normal" | "notice" | "warning" | "danger" | "unknown";

export type GasLevel = {
  id: GasLevelId;
  /** 0 = bình thường … 3 = nguy hiểm; null = chưa đánh giá được. */
  rank: 0 | 1 | 2 | 3 | null;
  label: string;
  advice: string;
  /** Tỷ lệ ADC / thang đo đầy đủ (0–1) hoặc null nếu không có số đo. */
  ratio: number | null;
};

/** Cận dưới (tỷ lệ ADC/full-scale) của mức Chú ý, Cảnh báo, Nguy hiểm. */
export const GAS_LEVEL_THRESHOLDS: Record<
  GasSensorKind,
  readonly [number, number, number]
> = {
  mq2: [0.35, 0.55, 0.75],
  mq7: [0.35, 0.55, 0.75],
};

const TEXT: Record<GasLevelId, { label: string; advice: string }> = {
  normal: { label: "Bình thường", advice: "Chưa thấy dấu hiệu bất thường." },
  notice: {
    label: "Chú ý",
    advice: "Tín hiệu tăng, hãy mở cửa thông gió và theo dõi.",
  },
  warning: {
    label: "Cảnh báo",
    advice: "Tắt nguồn lửa, mở cửa thông gió và chuẩn bị rời khu vực.",
  },
  danger: {
    label: "Nguy hiểm",
    advice:
      "Rời khỏi khu vực ngay, không bật tắt thiết bị điện, gọi 114 khi an toàn.",
  },
  unknown: {
    label: "Chưa đánh giá",
    advice: "Chưa đủ dữ liệu hợp lệ để đánh giá mức.",
  },
};
const BY_RANK: GasLevelId[] = ["normal", "notice", "warning", "danger"];

export type GasLevelInput = {
  kind: GasSensorKind;
  adc_raw: number | null;
  adc_bits: number;
  quality: "valid" | "invalid" | "warming_up" | "uncalibrated" | "heating";
  /** Trạng thái cảnh báo do chính thiết bị báo trong alert_snapshot. */
  device_alert?: "normal" | "active" | "unknown" | "not_configured";
  /** Dữ liệu cũ hoặc thiết bị offline: không được kết luận mức. */
  stale?: boolean;
};

const make = (id: GasLevelId, ratio: number | null): GasLevel => ({
  id,
  rank: id === "unknown" ? null : (BY_RANK.indexOf(id) as 0 | 1 | 2 | 3),
  ...TEXT[id],
  ratio,
});

export function gasLevel(input: GasLevelInput): GasLevel {
  const { kind, adc_raw, adc_bits, quality, device_alert, stale } = input;
  const full = 2 ** adc_bits - 1;
  const ratio =
    adc_raw === null || !Number.isFinite(adc_raw)
      ? null
      : Math.min(adc_raw / full, 1);
  // Thiết bị tự báo cảnh báo thì luôn được hiển thị, kể cả khi dữ liệu cảm biến thiếu.
  const fromDevice = device_alert === "active" ? 2 : 0;
  const usable =
    !stale &&
    ratio !== null &&
    (quality === "valid" || quality === "uncalibrated");
  if (!usable)
    return fromDevice
      ? make(BY_RANK[fromDevice]!, ratio)
      : make("unknown", ratio);
  const [notice, warning, danger] = GAS_LEVEL_THRESHOLDS[kind];
  const fromAdc =
    ratio! >= danger ? 3 : ratio! >= warning ? 2 : ratio! >= notice ? 1 : 0;
  return make(BY_RANK[Math.max(fromAdc, fromDevice)]!, ratio);
}
