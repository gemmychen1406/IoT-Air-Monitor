import { HelpCircle } from "lucide-react";
import type { DeviceView } from "@iot/contracts";

export function SensorMeaningGuide({ device }: { device: DeviceView }) {
  const unavailable = device.status !== "online" || !device.latest;
  return (
    <details className="panel sensor-meaning">
      <summary>
        <HelpCircle size={18} /> Cách đọc số liệu
      </summary>
      {unavailable ? (
        <p>
          <b>Chưa đủ dữ liệu mới để đánh giá.</b> Thiết bị đang offline hoặc
          chưa có số đo. Giá trị cũ không phản ánh tình trạng hiện tại.
        </p>
      ) : null}
      <dl>
        <div>
          <dt>Nhiệt độ và độ ẩm</dt>
          <dd>Nhiệt độ (°C) và độ ẩm tương đối (%RH) tại vị trí cảm biến.</dd>
        </div>
        <div>
          <dt>MQ-2 (gas, khói) và MQ-7 (CO)</dt>
          <dd>
            Số đo là tín hiệu điện (ADC) của cảm biến, chưa quy ra ppm. Mức Bình
            thường / Chú ý / Cảnh báo / Nguy hiểm là ước tính theo tín hiệu này.
          </dd>
        </div>
      </dl>
      <p>
        “Không có cảnh báo” chỉ là trạng thái của hệ thống cảnh báo, không phải
        xác nhận môi trường an toàn.
      </p>
    </details>
  );
}
