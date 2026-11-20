import type { ReactNode } from "react";
export const sensorNames: Record<string, string> = {
  dht11: "Nhiệt độ & độ ẩm",
  temperature: "Nhiệt độ",
  humidity: "Độ ẩm",
  mq2: "Khí MQ-2",
  mq7: "CO MQ-7",
  flame: "Cảm biến lửa",
  device: "Thiết bị",
};
export const qualityNames: Record<string, string> = {
  valid: "Hợp lệ",
  invalid: "Lỗi đọc",
  warming_up: "Đang khởi động",
  heating: "Đang gia nhiệt",
  uncalibrated: "Chưa hiệu chuẩn",
};
export function date(value: string) {
  return new Date(value).toLocaleString("vi-VN");
}
export function duration(ms: number | null) {
  if (ms === null) return "Chưa đủ dữ liệu";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} giây`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)} phút`;
  return `${(ms / 3600000).toFixed(1)} giờ`;
}
export function Stat({
  title,
  children,
  help,
}: {
  title: string;
  children: ReactNode;
  help?: string;
}) {
  return (
    <div className="dd-stat">
      <span>{title}</span>
      <strong>{children}</strong>
      {help ? <small>{help}</small> : null}
    </div>
  );
}
export function Table({
  caption,
  headers,
  children,
}: {
  caption: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div
      className="dd-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th scope="col" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
