import { HelpCircle } from "lucide-react";
import type { DeviceView } from "@iot/contracts";

export function SensorMeaningGuide({ device }: { device: DeviceView }) {
  const unavailable = device.status !== "online" || !device.latest;
  return (
    <details className="panel sensor-meaning">
      <summary>
        <HelpCircle size={18} /> Chỉ số này có nghĩa là gì?
      </summary>
      {unavailable ? (
        <p>
          <b>Chưa đủ dữ liệu mới để đánh giá.</b> Thiết bị đang offline, chưa
          từng kết nối hoặc chưa có bản ghi cảm biến. Các giá trị cũ không xác
          nhận tình trạng hiện tại.
        </p>
      ) : null}
      <dl>
        <div>
          <dt>Nhiệt độ (°C)</dt>
          <dd>
            Mức nhiệt ghi nhận tại cảm biến; không tự động được gắn nhãn an toàn
            hay nguy hiểm.
          </dd>
        </div>
        <div>
          <dt>Độ ẩm tương đối (%RH)</dt>
          <dd>Tỷ lệ hơi ẩm tương đối trong không khí tại thời điểm đo.</dd>
        </div>
        <div>
          <dt>MQ-2 / MQ-7 (ADC)</dt>
          <dd>
            Tín hiệu điện thô từ cảm biến khí. Đây chưa phải nồng độ ppm, AQI
            hoặc phần trăm khí vì chưa có quy trình hiệu chuẩn.
          </dd>
        </div>
      </dl>
      <p>
        “Không có cảnh báo đang hoạt động” chỉ mô tả trạng thái hệ thống cảnh
        báo, không phải xác nhận môi trường an toàn.
      </p>
    </details>
  );
}
