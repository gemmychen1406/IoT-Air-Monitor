import type { RangeInput } from "./types.js";
import { localDateTime } from "./utils.js";

export function RangeFields({
  value,
  onChange,
}: {
  value: RangeInput;
  onChange: (value: RangeInput) => void;
}) {
  function quickRange(days: number) {
    const to = new Date();
    const from = new Date(to);
    if (days === 0) from.setHours(0, 0, 0, 0);
    else from.setDate(from.getDate() - days);
    onChange({
      from: localDateTime(from),
      to: localDateTime(to),
      bucket: days >= 30 ? "day" : days >= 7 ? "hour" : value.bucket,
    });
  }
  return (
    <div className="cr-range-wrap">
      <div className="cr-quick-range" aria-label="Chọn nhanh khoảng thời gian">
        <span>Chọn nhanh:</span>
        <button type="button" onClick={() => quickRange(0)}>
          Hôm nay
        </button>
        <button type="button" onClick={() => quickRange(7)}>
          7 ngày
        </button>
        <button type="button" onClick={() => quickRange(30)}>
          30 ngày
        </button>
      </div>
      <div className="cr-range">
        <label>
          Từ ngày
          <input
            type="datetime-local"
            value={value.from}
            onChange={(event) =>
              onChange({ ...value, from: event.target.value })
            }
          />
        </label>
        <label>
          Đến ngày
          <input
            type="datetime-local"
            value={value.to}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
          />
        </label>
        <label>
          Độ chi tiết
          <select
            value={value.bucket}
            onChange={(event) =>
              onChange({
                ...value,
                bucket: event.target.value as RangeInput["bucket"],
              })
            }
          >
            <option value="minute">Theo phút</option>
            <option value="hour">Theo giờ</option>
            <option value="day">Theo ngày</option>
          </select>
        </label>
      </div>
    </div>
  );
}
