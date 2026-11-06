import type { DeviceView } from '@iot/contracts';
import { Thermometer, Droplets, Wind, Flame, Activity } from 'lucide-react';
import { sensorFreshness } from '../lib/freshness.js';
import { useEffect, useState } from 'react';

const qualityText = {
  valid: 'Tín hiệu hợp lệ',
  invalid: 'Lỗi cảm biến',
  warming_up: 'Đang làm nóng',
  uncalibrated: 'Chưa hiệu chuẩn',
  heating: 'Đang gia nhiệt',
};
export const alertText = {
  normal: 'Không kích hoạt',
  active: 'Đang cảnh báo',
  unknown: 'Chưa xác định',
  not_configured: 'Chưa cấu hình đánh giá',
};

export function SensorPanel({ device, now }: { device: DeviceView; now?: number }) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const reading = device.latest;
  return (
    <section aria-label={`Cảm biến ${device.name}`}>
      {device.source_kind === 'simulator' ? (
        <div className="notice simulation">
          <Activity size={16} /> Dữ liệu mô phỏng — không phải số đo phần cứng
        </div>
      ) : null}
      {!reading ? (
        <div className="empty">
          <Activity size={30} />
          <h3>Chưa có dữ liệu cảm biến</h3>
          <p>Đăng ký credential và kết nối thiết bị hoặc simulator để bắt đầu.</p>
        </div>
      ) : (
        <>
          <div className="sensor-grid">
            {[
              {
                title: 'Nhiệt độ',
                value: reading.payload.sensors.dht11.temperature_c,
                unit: '°C',
                sensor: reading.payload.sensors.dht11,
                icon: Thermometer,
                color: 'orange',
              },
              {
                title: 'Độ ẩm',
                value: reading.payload.sensors.dht11.humidity_pct,
                unit: '%RH',
                sensor: reading.payload.sensors.dht11,
                icon: Droplets,
                color: 'blue',
              },
              {
                title: 'MQ-2',
                value: reading.payload.sensors.mq2.adc_raw,
                unit: 'ADC',
                sensor: reading.payload.sensors.mq2,
                icon: Wind,
                color: 'teal',
              },
              {
                title: 'MQ-7',
                value: reading.payload.sensors.mq7.adc_raw,
                unit: 'ADC',
                sensor: reading.payload.sensors.mq7,
                icon: Wind,
                color: 'purple',
              },
            ].map(({ title, value, unit, sensor, icon: Icon, color }) => (
              <article className="panel sensor-card" key={title} aria-label={title}>
                <div className="sensor-heading">
                  <span>{title}</span>
                  <span className={`icon-box ${color}`}>
                    <Icon size={20} />
                  </span>
                </div>
                <div className="reading-value">
                  {value ?? '—'} <small>{unit}</small>
                </div>
                <p>{qualityText[sensor.quality]}</p>
                <span className="freshness">
                  {sensorFreshness(
                    reading,
                    sensor.age_ms,
                    now ?? clock,
                    title === 'MQ-7' ? 180000 : 15000,
                  )}
                </span>
              </article>
            ))}
          </div>
          <div className="panel alert-strip">
            <Flame size={22} />
            <div>
              <strong>Flame Sensor</strong>
              <p>
                {reading.payload.sensors.flame.detected === null
                  ? 'Chưa xác định'
                  : reading.payload.sensors.flame.detected
                    ? 'Có tín hiệu phát hiện lửa'
                    : 'Không phát hiện'}
              </p>
            </div>
            <span
              className={`badge ${reading.payload.alert_snapshot.flame === 'active' ? 'danger' : ''}`}
            >
              {alertText[reading.payload.alert_snapshot.flame]}
            </span>
            <span className="muted">
              Lệnh còi: {reading.payload.alert_snapshot.buzzer_commanded_on ? 'Bật' : 'Tắt'}
            </span>
          </div>
          <div className="gas-policies">
            <span>
              Gas: <strong>{alertText[reading.payload.alert_snapshot.gas]}</strong>
            </span>
            <span>
              CO: <strong>{alertText[reading.payload.alert_snapshot.co]}</strong>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
