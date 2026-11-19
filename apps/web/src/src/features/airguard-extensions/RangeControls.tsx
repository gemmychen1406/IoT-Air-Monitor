import type { RangeInput } from './types.js';

export function RangeControls({ value, onChange }: { value: RangeInput; onChange: (value: RangeInput) => void }) {
  return (
    <div className="extension-range">
      <label>
        Từ
        <input type="datetime-local" value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value })} />
      </label>
      <label>
        Đến
        <input type="datetime-local" value={value.to} onChange={(event) => onChange({ ...value, to: event.target.value })} />
      </label>
      <label>
        Độ phân giải
        <select value={value.bucket} onChange={(event) => onChange({ ...value, bucket: event.target.value as RangeInput['bucket'] })}>
          <option value="minute">Phút</option>
          <option value="hour">Giờ</option>
          <option value="day">Ngày</option>
        </select>
      </label>
    </div>
  );
}

