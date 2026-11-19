import type { AnalyticsView } from "@iot/contracts";
import { coverage, formatValue } from "./utils.js";
import type { RangeInput } from "./types.js";

export function AdminAnalysisPanel({
  data,
  range,
}: {
  data: AnalyticsView;
  range: RangeInput;
}) {
  const quality = coverage(data, range);
  return (
    <details className="panel cr-admin">
      <summary>Xem chi tiết kỹ thuật (quản trị viên)</summary>
      <div className="cr-admin-grid">
        <span>
          <b>Mẫu hợp lệ</b>
          {data.summary.valid_count.toLocaleString("vi-VN")}
        </span>
        <span>
          <b>Mẫu không hợp lệ</b>
          {data.summary.invalid_count.toLocaleString("vi-VN")}
        </span>
        <span>
          <b>Bucket có dữ liệu</b>
          {quality.present}/{quality.expected}
        </span>
        <span>
          <b>Độ phủ bucket</b>
          {quality.percent === null
            ? "Không xác định"
            : `${quality.percent.toFixed(1)}%`}
        </span>
        <span>
          <b>Min / max</b>
          {formatValue(data.summary.min, data.unit)} /{" "}
          {formatValue(data.summary.max, data.unit)}
        </span>
        <span>
          <b>Cơ sở thời gian</b>
          {data.time_basis === "received"
            ? "Thời gian server nhận"
            : "Thời gian thiết bị đo"}
        </span>
        <span>
          <b>Nguồn</b>
          {data.source_kind === "simulator" ? "Simulator" : "Thiết bị thật"}
        </span>
        <span>
          <b>Dạng dữ liệu</b>
          {data.uses_rollups ? "Có dữ liệu tổng hợp (rollup)" : "Dữ liệu thô"}
        </span>
        <span>
          <b>ADC profile</b>
          {data.adc_bits ? `${data.adc_bits} bit` : "Không áp dụng"}
        </span>
      </div>
      {quality.missing ? (
        <p className="muted">
          Có {quality.missing} bucket không có mẫu hợp lệ. Độ phủ bucket không
          phải tỷ lệ mẫu hợp lệ.
        </p>
      ) : null}
    </details>
  );
}
