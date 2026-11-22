import {
  diagnosticOptionsSchema,
  type DiagnosticOptions,
} from "@iot/contracts";
export const defaults = diagnosticOptionsSchema.parse({});
export function readOptions(key: string) {
  try {
    return diagnosticOptionsSchema.parse(
      JSON.parse(localStorage.getItem(key) ?? "{}"),
    );
  } catch {
    return defaults;
  }
}
export const optionLabels: Record<
  keyof DiagnosticOptions,
  { name: string; min: number; max: number; unit: string }
> = {
  gap_multiplier: {
    name: "Báo thiếu mẫu khi vượt",
    min: 2,
    max: 20,
    unit: "lần chu kỳ gửi",
  },
  flat_minutes: {
    name: "Kiểm tra số đo ít thay đổi sau",
    min: 5,
    max: 120,
    unit: "phút",
  },
  temperature_jump: {
    name: "Nhiệt độ thay đổi nhanh từ",
    min: 1,
    max: 30,
    unit: "°C / cặp mẫu",
  },
  humidity_jump: {
    name: "Độ ẩm thay đổi nhanh từ",
    min: 2,
    max: 80,
    unit: "điểm %RH / cặp mẫu",
  },
  gas_jump_pct: {
    name: "Tín hiệu khí thay đổi nhanh từ",
    min: 5,
    max: 90,
    unit: "% toàn thang ADC / cặp mẫu",
  },
  reboot_threshold: {
    name: "Nhắc kiểm tra nguồn từ",
    min: 2,
    max: 20,
    unit: "lần đổi phiên / giờ",
  },
};
