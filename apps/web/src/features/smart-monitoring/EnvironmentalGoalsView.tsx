import { useState } from 'react';
import type { DeviceView } from '@iot/contracts';
import { Target, Sliders, CheckCircle2, RotateCcw, AlertCircle, Sparkles, HeartPulse, ShieldCheck } from 'lucide-react';
import type { EnvironmentalTarget } from './types.js';
import {
  calculateEcoScore,
  getDefaultTarget,
  loadTargets,
  saveTargets,
} from './utils.js';
import OutdoorWeatherCard from './OutdoorWeatherCard.js';
import HourlyTimelineView from './HourlyTimelineView.js';
import SmartActuatorControls from './SmartActuatorControls.js';

export default function EnvironmentalGoalsView({ devices }: { devices: DeviceView[] }) {
  const [targets, setTargets] = useState<Record<string, EnvironmentalTarget>>(() =>
    loadTargets(devices),
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(
    devices[0]?.id ?? '',
  );
  const [isEditing, setIsEditing] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const selectedDevice =
    devices.find((d) => d.id === selectedDeviceId) ?? devices[0];
  const currentTarget =
    (selectedDevice && targets[selectedDevice.id]) || getDefaultTarget(selectedDevice);

  const [editDraft, setEditDraft] = useState<EnvironmentalTarget>(currentTarget);

  function handleSelectDevice(id: string) {
    setSelectedDeviceId(id);
    const d = devices.find((x) => x.id === id);
    const t = targets[id] ?? getDefaultTarget(d);
    setEditDraft(t);
    setIsEditing(false);
  }

  function handleSave() {
    if (!selectedDevice) return;
    const updated = { ...targets, [selectedDevice.id]: { ...editDraft, deviceId: selectedDevice.id } };
    setTargets(updated);
    saveTargets(updated);
    setIsEditing(false);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  }

  function handleReset() {
    if (!selectedDevice) return;
    const def = getDefaultTarget(selectedDevice);
    setEditDraft(def);
    const updated = { ...targets, [selectedDevice.id]: def };
    setTargets(updated);
    saveTargets(updated);
    setIsEditing(false);
  }

  if (!selectedDevice) {
    return (
      <div className="panel empty">
        <Target size={36} />
        <h3>Chưa có thiết bị nào</h3>
        <p>Vui lòng đăng ký thiết bị hoặc simulator trước khi thiết lập mục tiêu.</p>
      </div>
    );
  }

  const scoreResult = calculateEcoScore(selectedDevice, currentTarget);
  const reading = selectedDevice.latest?.payload;

  return (
    <div className="goals-view-container">
      {/* 1. Thanh chọn trạm đo */}
      <div className="section-toolbar">
        <div>
          <h3>Mục tiêu Môi trường & Chỉ số Sức khỏe Eco-Score</h3>
          <p className="muted">
            Thiết lập ngưỡng chuẩn mực cho từng phòng để hệ thống giám sát và đánh giá chất lượng vi khí hậu.
          </p>
        </div>
        <div className="toolbar-actions">
          <label className="device-select-inline">
            <span>Trạm đánh giá:</span>
            <select
              value={selectedDevice.id}
              onChange={(e) => handleSelectDevice(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.location ? `(${d.location})` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {savedNotice && (
        <div className="notice success-banner">
          <CheckCircle2 size={18} /> Đã lưu cấu hình mục tiêu môi trường cho {selectedDevice.name}!
        </div>
      )}

      {/* 2. Grid 2 cột: Cột trái đồng hồ điểm Eco-Score, cột phải các chỉ số mục tiêu */}
      <div className="goals-main-grid">
        {/* Card điểm sức khỏe môi trường */}
        <div className="panel eco-score-card">
          <div className="score-header">
            <span>Chỉ số Sức khỏe Môi trường</span>
            <Sparkles size={20} color={scoreResult.color} />
          </div>

          <div className="score-circle-wrapper">
            <div
              className="score-circle"
              style={{
                borderColor: scoreResult.color,
                boxShadow: `0 0 35px ${scoreResult.color}33`,
              }}
            >
              <span className="score-number" style={{ color: scoreResult.color }}>
                {scoreResult.score}
              </span>
              <span className="score-label">/ 100 điểm</span>
            </div>
          </div>

          <div
            className="score-badge"
            style={{
              backgroundColor: `${scoreResult.color}22`,
              color: scoreResult.color,
              borderColor: scoreResult.color,
            }}
          >
            {scoreResult.rating}
          </div>

          <p className="score-summary">{scoreResult.summaryText}</p>

          <div className="comfort-tag-box">
            <span className="comfort-title">
              <HeartPulse size={14} /> Mức độ dễ chịu:
            </span>
            <strong className="comfort-val">{scoreResult.comfortLevel}</strong>
          </div>

          <div className="score-stats-mini">
            <div>
              <span className="mini-label">Tỷ lệ đạt chuẩn</span>
              <strong className="mini-val">{scoreResult.complianceRate}%</strong>
            </div>
            <div>
              <span className="mini-label">Trạng thái trạm</span>
              <strong
                className="mini-val"
                style={{
                  color: selectedDevice.status === 'online' ? '#10b981' : '#f59e0b',
                }}
              >
                {selectedDevice.status === 'online' ? 'Đang online' : 'Chưa kết nối'}
              </strong>
            </div>
          </div>
        </div>

        {/* Card chi tiết các tiêu chí và ngưỡng mục tiêu */}
        <div className="panel goals-detail-card">
          <div className="card-top-actions">
            <div>
              <h4>Chỉ số đo đạc & Ngưỡng mục tiêu mong muốn</h4>
              <small className="muted">Lưu cấu hình riêng có thời điểm hiệu lực, không ghi đè cảnh báo phần cứng</small>
            </div>
            <div>
              {!isEditing ? (
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setEditDraft(currentTarget);
                    setIsEditing(true);
                  }}
                >
                  <Sliders size={16} /> Tùy chỉnh ngưỡng
                </button>
              ) : (
                <div className="edit-btn-group">
                  <button className="btn-secondary" onClick={() => setIsEditing(false)}>
                    Hủy
                  </button>
                  <button className="btn-secondary" onClick={handleReset} title="Khôi phục mặc định khuyến nghị">
                    <RotateCcw size={15} /> Mặc định
                  </button>
                  <button className="btn-primary" onClick={handleSave}>
                    Lưu mục tiêu
                  </button>
                </div>
              )}
            </div>
          </div>

          {!reading ? (
            <div className="empty-sub">
              <AlertCircle size={24} />
              <p>Chưa có mẫu đo từ trạm này để so sánh với mục tiêu.</p>
            </div>
          ) : (
            <div className="goals-metrics-list">
              {/* 1. Nhiệt độ */}
              <div className="metric-row">
                <div className="metric-info">
                  <div className="metric-title-wrap">
                    <strong>Nhiệt độ phòng (DHT11)</strong>
                    <span className="metric-current">
                      Hiện tại: <b>{reading.sensors.dht11.temperature_c ?? '—'} °C</b>
                    </span>
                  </div>
                  <div className="metric-bounds">
                    Mục tiêu: {currentTarget.minTemp}°C — {currentTarget.maxTemp}°C
                  </div>
                </div>
                {isEditing ? (
                  <div className="inline-inputs">
                    <label>
                      Min:
                      <input
                        type="number"
                        value={editDraft.minTemp}
                        onChange={(e) => setEditDraft({ ...editDraft, minTemp: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Max:
                      <input
                        type="number"
                        value={editDraft.maxTemp}
                        onChange={(e) => setEditDraft({ ...editDraft, maxTemp: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                ) : (
                  <span className={`status-pill ${scoreResult.tempStatus === 'ideal' ? 'status-ok' : 'status-warn'}`}>
                    {scoreResult.tempStatus === 'ideal' ? '✓ Đạt chuẩn' : scoreResult.tempStatus === 'high' ? '↑ Quá nóng' : '↓ Quá lạnh'}
                  </span>
                )}
              </div>

              {/* 2. Độ ẩm */}
              <div className="metric-row">
                <div className="metric-info">
                  <div className="metric-title-wrap">
                    <strong>Độ ẩm không khí (DHT11)</strong>
                    <span className="metric-current">
                      Hiện tại: <b>{reading.sensors.dht11.humidity_pct ?? '—'} %RH</b>
                    </span>
                  </div>
                  <div className="metric-bounds">
                    Mục tiêu: {currentTarget.minHumidity}% — {currentTarget.maxHumidity}%
                  </div>
                </div>
                {isEditing ? (
                  <div className="inline-inputs">
                    <label>
                      Min:
                      <input
                        type="number"
                        value={editDraft.minHumidity}
                        onChange={(e) => setEditDraft({ ...editDraft, minHumidity: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Max:
                      <input
                        type="number"
                        value={editDraft.maxHumidity}
                        onChange={(e) => setEditDraft({ ...editDraft, maxHumidity: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                ) : (
                  <span className={`status-pill ${scoreResult.humidityStatus === 'ideal' ? 'status-ok' : 'status-warn'}`}>
                    {scoreResult.humidityStatus === 'ideal' ? '✓ Đạt chuẩn' : scoreResult.humidityStatus === 'high' ? '↑ Ẩm ướt' : '↓ Khô hanh'}
                  </span>
                )}
              </div>

              {/* 3. Khí gas / khói MQ-2 */}
              <div className="metric-row">
                <div className="metric-info">
                  <div className="metric-title-wrap">
                    <strong>Khí dễ cháy / Khói (MQ-2)</strong>
                    <span className="metric-current">
                      Hiện tại: <b>{reading.sensors.mq2.adc_raw ?? '—'} ADC</b>
                    </span>
                  </div>
                  <div className="metric-bounds">Ngưỡng tối đa: &lt; {currentTarget.maxMq2Adc} ADC</div>
                </div>
                {isEditing ? (
                  <div className="inline-inputs">
                    <label>
                      Max:
                      <input
                        type="number"
                        value={editDraft.maxMq2Adc}
                        onChange={(e) => setEditDraft({ ...editDraft, maxMq2Adc: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                ) : (
                  <span className={`status-pill ${scoreResult.gasStatus === 'safe' ? 'status-ok' : scoreResult.gasStatus === 'warning' ? 'status-warn' : 'status-danger'}`}>
                    {scoreResult.gasStatus === 'safe' ? '✓ An toàn' : scoreResult.gasStatus === 'warning' ? '⚠️ Tích tụ' : '🔥 Nguy hại'}
                  </span>
                )}
              </div>

              {/* 4. Khí độc CO (MQ-7) */}
              <div className="metric-row">
                <div className="metric-info">
                  <div className="metric-title-wrap">
                    <strong>Khí ngạt CO (MQ-7)</strong>
                    <span className="metric-current">
                      Hiện tại: <b>{reading.sensors.mq7.adc_raw ?? '—'} ADC</b>
                    </span>
                  </div>
                  <div className="metric-bounds">Ngưỡng tối đa: &lt; {currentTarget.maxMq7Adc} ADC</div>
                </div>
                {isEditing ? (
                  <div className="inline-inputs">
                    <label>
                      Max:
                      <input
                        type="number"
                        value={editDraft.maxMq7Adc}
                        onChange={(e) => setEditDraft({ ...editDraft, maxMq7Adc: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                ) : (
                  <span className={`status-pill ${scoreResult.coStatus === 'safe' ? 'status-ok' : scoreResult.coStatus === 'warning' ? 'status-warn' : 'status-danger'}`}>
                    {scoreResult.coStatus === 'safe' ? '✓ Trong lành' : scoreResult.coStatus === 'warning' ? '⚠️ Cần thoáng khí' : '☠️ Nguy hiểm'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. So sánh Vi khí hậu Trong nhà & Ngoài trời (Dữ liệu thời tiết trực tiếp) */}
      <OutdoorWeatherCard device={selectedDevice} />

      {/* 4. Trung tâm điều khiển thiết bị ảo IoT (Smart Actuator Controls) */}
      <SmartActuatorControls key={selectedDevice.id} device={selectedDevice} />

      {/* 5. Biểu đồ tiến độ đạt chuẩn 24 giờ (Hourly Compliance Timeline) */}
      <HourlyTimelineView device={selectedDevice} />
    </div>
  );
}
