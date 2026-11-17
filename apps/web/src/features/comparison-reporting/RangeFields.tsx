import type { RangeInput } from "./types.js";

export function RangeFields({
  value,
  onChange,
}: {
  value: RangeInput;
  onChange: (value: RangeInput) => void;
}) {
  return (
    <div className="cr-range">
      <label>
        Từ ngày
        <input
          type="datetime-local"
          value={value.from}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
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
  );
}
