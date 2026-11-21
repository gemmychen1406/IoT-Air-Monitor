import { useState } from 'react';
import type { DeviceView } from '@iot/contracts';
import {
  Target,
  Sliders,
  CheckCircle2,
  RotateCcw,
  AlertCircle,
  Sparkles,
  HeartPulse,
  Utensils,
  Car,
  Armchair,
  Bed,
  Box,
  Home,
  ShieldCheck,
  Zap,
  Leaf,
  Wind,
  Baby,
} from 'lucide-react';
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

// Danh sách các chế độ mẫu 1-click
const PRESETS: Array<{
  id: string;
  name: string;
  icon: typeof Leaf;
  desc: string;
  values: Omit<EnvironmentalTarget, 'deviceId'>;
}> = [
  {
    id: 'comfort',
    name: 'Tiện nghi Tiêu chuẩn',
    icon: Leaf,
    desc: '23–27°C · 45–65% RH · Chuẩn sinh hoạt gia đình',
    values: {
      minTemp: 23,
      maxTemp: 27,
      minHumidity: 45,
      maxHumidity: 65,
      maxMq2Adc: 1000,
      maxMq7Adc: 600,
    },
  },
  {
    id: 'eco',
    name: 'Mát mẻ & Tiết kiệm điện',
    icon: Wind,
    desc: '24–28°C · 40–70% RH · Tận dụng đối lưu tự nhiên',
    values: {
      minTemp: 24,
      maxTemp: 28,
      minHumidity: 40,
      maxHumidity: 70,
      maxMq2Adc: 1200,
      maxMq7Adc: 700,
    },
  },
  {
    id: 'care',
    name: 'Trẻ nhỏ & Người cao tuổi',
    icon: Baby,
    desc: '23–26°C · 50–60% RH · Nghiêm ngặt về khí độc',
    values: {
      minTemp: 23,
      maxTemp: 26,
      minHumidity: 50,
      maxHumidity: 60,
      maxMq2Adc: 800,
      maxMq7Adc: 450,
    },
  },
  {
    id: 'kitchen',
    name: 'Bếp nấu / Thoát mùi',
    icon: Utensils,
    desc: '22–31°C · 40–75% RH · Cho phép dung sai nấu nướng',
    values: {
      minTemp: 22,
      maxTemp: 31,
      minHumidity: 40,
      maxHumidity: 75,
      maxMq2Adc: 1600,
      maxMq7Adc: 900,
    },
  },
];

function getRoomIcon(name: string, location?: string) {
  const text = `${name} ${location ?? ''}`.toLowerCase();
  if (text.includes('bếp') || text.includes('kitchen') || text.includes('nấu')) return Utensils;
  if (text.includes('hầm') || text.includes('xe') || text.includes('garage')) return Car;
  if (text.includes('khách') || text.includes('living')) return Armchair;
  if (text.includes('ngủ') || text.includes('bed')) return Bed;
  if (text.includes('kho') || text.includes('kỹ thuật')) return Box;
  return Home;
}

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

  function handleApplyPreset(presetValues: Omit<EnvironmentalTarget, 'deviceId'>) {
    if (!selectedDevice) return;
    const newTarget: EnvironmentalTarget = {
      ...presetValues,
      deviceId: selectedDevice.id,
    };
    setEditDraft(newTarget);
    const updated = { ...targets, [selectedDevice.id]: newTarget };
    setTargets(updated);
    saveTargets(updated);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  }

  function handleSave() {
    if (!selectedDevice) return;
    const updated = {
      ...targets,
      [selectedDevice.id]: { ...editDraft, deviceId: selectedDevice.id },
    };
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
        <p>Vui lòng đăng ký thiết bị hoặc khởi động simulator trước khi thiết lập mục tiêu.</p>
      </div>
    );
  }

  const scoreResult = calculateEcoScore(selectedDevice, currentTarget);
  const reading = selectedDevice.latest?.payload;

  // Tính toán vị trí thanh dải đo trực quan
  const curTemp = reading?.sensors.dht11.temperature_c ?? 25;
  const curHum = reading?.sensors.dht11.humidity_pct ?? 60;
  const curMq2 = reading?.sensors.mq2.adc_raw ?? 600;
  const curMq7 = reading?.sensors.mq7.adc_raw ?? 400;

  // Thước nhiệt độ: từ 15°C đến 40°C (dải 25°C)
  const tempMinPct = Math.max(0, Math.min(100, ((currentTarget.minTemp - 15) / 25) * 100));
  const tempMaxPct = Math.max(0, Math.min(100, ((currentTarget.maxTemp - 15) / 25) * 100));
  const tempValPct = Math.max(0, Math.min(100, ((curTemp - 15) / 25) * 100));

  // Thước độ ẩm: từ 20% đến 100% (dải 80%)
  const humMinPct = Math.max(0, Math.min(100, ((currentTarget.minHumidity - 20) / 80) * 100));
  const humMaxPct = Math.max(0, Math.min(100, ((currentTarget.maxHumidity - 20) / 80) * 100));
  const humValPct = Math.max(0, Math.min(100, ((curHum - 20) / 80) * 100));

  // Thước khí gas MQ-2: từ 0 đến 3000 ADC
  const mq2MaxPct = Math.max(0, Math.min(100, (currentTarget.maxMq2Adc / 3000) * 100));
  const mq2ValPct = Math.max(0, Math.min(100, (curMq2 / 3000) * 100));

  // Thước CO MQ-7: từ 0 đến 2500 ADC
  const mq7MaxPct = Math.max(0, Math.min(100, (currentTarget.maxMq7Adc / 2500) * 100));
  const mq7ValPct = Math.max(0, Math.min(100, (curMq7 / 2500) * 100));

  return (
    <div className="goals-view-container">
      {/* 1. DÃY THẺ PHÒNG TRỰC QUAN (ROOM SWITCHER PILLS) - 1 CHẠM */}
      <div className="smart-room-selector">
        <div className="room-selector-header">
          <span className="room-selector-title">
            <Home size={16} /> Chọn không gian phòng quan trắc:
          </span>
          <span className="room-selector-hint">Click 1 chạm để chuyển phòng</span>
        </div>

        <div className="room-pills-track">
          {devices.map((d) => {
            const RoomIcon = getRoomIcon(d.name, d.location);
            const isSelected = d.id === selectedDevice.id;
            const dTarget = targets[d.id] ?? getDefaultTarget(d);
            const dScore = calculateEcoScore(d, dTarget);

            return (
              <button
                key={d.id}
                type="button"
                className={`room-pill ${isSelected ? 'active' : ''}`}
                onClick={() => handleSelectDevice(d.id)}
              >
                <div className="room-pill-icon">
                  <RoomIcon size={20} />
                </div>
                <div className="room-pill-body">
                  <strong className="room-pill-name">{d.name}</strong>
                  <span className="room-pill-loc">{d.location || 'Khu vực chung'}</span>
                </div>
                <div className="room-pill-meta">
                  <span
                    className="room-score-tag"
                    style={{
                      background: `${dScore.color}22`,
                      color: dScore.color,
                      borderColor: `${dScore.color}44`,
                    }}
                  >
                    {dScore.score}đ
                  </span>
                  <span
                    className={`room-status-dot ${d.status === 'online' ? 'online' : 'offline'}`}
                    title={d.status === 'online' ? 'Cảm biến đang trực tiếp' : 'Mất kết nối'}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {savedNotice && (
        <div className="notice success-banner">
          <CheckCircle2 size={18} /> Đã cập nhật mục tiêu tiện nghi cho {selectedDevice.name}!
        </div>
      )}

      {/* 2. DASHBOARD LƯỚI THÔNG MINH CÂN ĐỐI (2 CỘT) */}
      <div className="smart-dashboard-grid">
        {/* CỘT TRÁI: Eco-Score lớn + So sánh Thời tiết ngoài trời */}
        <div className="grid-col-left">
          {/* Card điểm sức khỏe môi trường Eco-Score */}
          <div className="panel eco-score-card">
            <div className="score-header">
              <span>Chỉ số Sức khỏe Tiện nghi</span>
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
        </div>

        {/* CỘT PHẢI: Chi tiết Mục tiêu & Thanh đo Gauge trực quan */}
        <div className="grid-col-right">
          <div className="panel goals-detail-card">
            <div className="card-top-actions">
              <div>
                <h4>Chỉ số Vi khí hậu & Dải mục tiêu mong muốn</h4>
                <small className="muted">
                  Dải nhiệt ẩm tiện nghi cá nhân, tự động lưu trên trình duyệt
                </small>
              </div>

              <div>
                {!isEditing ? (
                  <button
                    type="button"
                    className="btn-secondary btn-tune"
                    onClick={() => {
                      setEditDraft(currentTarget);
                      setIsEditing(true);
                    }}
                  >
                    <Sliders size={15} /> Tùy chỉnh chi tiết
                  </button>
                ) : (
                  <div className="edit-btn-group">
                    <button type="button" className="btn-secondary" onClick={() => setIsEditing(false)}>
                      Hủy
                    </button>
                    <button type="button" className="btn-secondary" onClick={handleReset} title="Khôi phục mặc định">
                      <RotateCcw size={14} /> Mặc định
                    </button>
                    <button type="button" className="btn-primary" onClick={handleSave}>
                      Lưu thay đổi
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* CHẾ ĐỘ MẪU 1-CLICK (QUICK PRESETS) */}
            <div className="quick-presets-bar">
              <span className="presets-label">
                <Zap size={14} /> Chọn nhanh chế độ mẫu:
              </span>
              <div className="preset-buttons">
                {PRESETS.map((p) => {
                  const Icon = p.icon;
                  const isCurrent =
                    currentTarget.minTemp === p.values.minTemp &&
                    currentTarget.maxTemp === p.values.maxTemp &&
                    currentTarget.minHumidity === p.values.minHumidity &&
                    currentTarget.maxHumidity === p.values.maxHumidity;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`preset-btn ${isCurrent ? 'active' : ''}`}
                      onClick={() => handleApplyPreset(p.values)}
                      title={p.desc}
                    >
                      <Icon size={14} />
                      <span>{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {!reading ? (
              <div className="empty-sub">
                <AlertCircle size={24} />
                <p>Chưa có mẫu đo từ trạm này để hiển thị thanh thước đo trực quan.</p>
              </div>
            ) : (
              <div className="visual-gauges-list">
                {/* 1. THANH ĐO NHIỆT ĐỘ */}
                <div className="visual-gauge-row">
                  <div className="gauge-header">
                    <div className="gauge-label-group">
                      <strong>Nhiệt độ phòng (DHT11)</strong>
                      <span className="gauge-current-val">
                        Hiện tại: <b>{reading.sensors.dht11.temperature_c ?? '—'}°C</b>
                      </span>
                    </div>
                    <span className={`status-pill ${scoreResult.tempStatus === 'ideal' ? 'status-ok' : 'status-warn'}`}>
                      {scoreResult.tempStatus === 'ideal'
                        ? '✓ Dễ chịu lý tưởng'
                        : scoreResult.tempStatus === 'high'
                          ? '↑ Hơi nóng bức'
                          : '↓ Hơi lạnh'}
                    </span>
                  </div>

                  {/* Thanh thước đo màu sắc */}
                  <div className="gauge-track-wrap">
                    <div className="gauge-track">
                      {/* Vùng xanh lá: dải mục tiêu */}
                      <div
                        className="gauge-sweet-spot"
                        style={{
                          left: `${tempMinPct}%`,
                          width: `${Math.max(4, tempMaxPct - tempMinPct)}%`,
                        }}
                        title={`Vùng lý tưởng: ${currentTarget.minTemp}°C - ${currentTarget.maxTemp}°C`}
                      />
                      {/* Con trỏ vị trí hiện tại */}
                      <div
                        className="gauge-pointer"
                        style={{ left: `${tempValPct}%` }}
                        title={`Hiện tại: ${curTemp}°C`}
                      >
                        <div className="pointer-pin" />
                        <span className="pointer-tag">{curTemp}°C</span>
                      </div>
                    </div>
                    <div className="gauge-scale-labels">
                      <span>15°C (Lạnh)</span>
                      <span className="scale-target-hint">
                        Mục tiêu: {currentTarget.minTemp}°C — {currentTarget.maxTemp}°C
                      </span>
                      <span>40°C (Nóng)</span>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="inline-inputs-editor">
                      <label>
                        Nhiệt độ tối thiểu (°C):
                        <input
                          type="number"
                          value={editDraft.minTemp}
                          onChange={(e) => setEditDraft({ ...editDraft, minTemp: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        Nhiệt độ tối đa (°C):
                        <input
                          type="number"
                          value={editDraft.maxTemp}
                          onChange={(e) => setEditDraft({ ...editDraft, maxTemp: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* 2. THANH ĐO ĐỘ ẨM */}
                <div className="visual-gauge-row">
                  <div className="gauge-header">
                    <div className="gauge-label-group">
                      <strong>Độ ẩm không khí (DHT11)</strong>
                      <span className="gauge-current-val">
                        Hiện tại: <b>{reading.sensors.dht11.humidity_pct ?? '—'}%RH</b>
                      </span>
                    </div>
                    <span className={`status-pill ${scoreResult.humidityStatus === 'ideal' ? 'status-ok' : 'status-warn'}`}>
                      {scoreResult.humidityStatus === 'ideal'
                        ? '✓ Độ ẩm cân bằng'
                        : scoreResult.humidityStatus === 'high'
                          ? '↑ Ẩm ướt / Nồm'
                          : '↓ Khô hanh'}
                    </span>
                  </div>

                  {/* Thanh thước đo màu sắc */}
                  <div className="gauge-track-wrap">
                    <div className="gauge-track">
                      <div
                        className="gauge-sweet-spot"
                        style={{
                          left: `${humMinPct}%`,
                          width: `${Math.max(4, humMaxPct - humMinPct)}%`,
                        }}
                        title={`Vùng lý tưởng: ${currentTarget.minHumidity}% - ${currentTarget.maxHumidity}%`}
                      />
                      <div
                        className="gauge-pointer"
                        style={{ left: `${humValPct}%` }}
                        title={`Hiện tại: ${curHum}%`}
                      >
                        <div className="pointer-pin" />
                        <span className="pointer-tag">{curHum}%</span>
                      </div>
                    </div>
                    <div className="gauge-scale-labels">
                      <span>20% (Khô)</span>
                      <span className="scale-target-hint">
                        Mục tiêu: {currentTarget.minHumidity}% — {currentTarget.maxHumidity}%
                      </span>
                      <span>100% (Rất ẩm)</span>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="inline-inputs-editor">
                      <label>
                        Độ ẩm tối thiểu (%RH):
                        <input
                          type="number"
                          value={editDraft.minHumidity}
                          onChange={(e) => setEditDraft({ ...editDraft, minHumidity: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        Độ ẩm tối đa (%RH):
                        <input
                          type="number"
                          value={editDraft.maxHumidity}
                          onChange={(e) => setEditDraft({ ...editDraft, maxHumidity: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* 3. THANH ĐO KHÍ GAS / KHÓI MQ-2 */}
                <div className="visual-gauge-row">
                  <div className="gauge-header">
                    <div className="gauge-label-group">
                      <strong>Khí dễ cháy / Khói (MQ-2)</strong>
                      <span className="gauge-current-val">
                        Hiện tại: <b>{reading.sensors.mq2.adc_raw ?? '—'} ADC</b>
                      </span>
                    </div>
                    <span
                      className={`status-pill ${
                        scoreResult.gasStatus === 'safe'
                          ? 'status-ok'
                          : scoreResult.gasStatus === 'warning'
                            ? 'status-warn'
                            : 'status-danger'
                      }`}
                    >
                      {scoreResult.gasStatus === 'safe'
                        ? '✓ An toàn tuyệt đối'
                        : scoreResult.gasStatus === 'warning'
                          ? '⚠️ Bắt đầu tích tụ'
                          : '🔥 Nguy cơ rò rỉ'}
                    </span>
                  </div>

                  <div className="gauge-track-wrap">
                    <div className="gauge-track">
                      <div
                        className="gauge-sweet-spot"
                        style={{
                          left: '0%',
                          width: `${mq2MaxPct}%`,
                        }}
                        title={`Ngưỡng an toàn: < ${currentTarget.maxMq2Adc} ADC`}
                      />
                      <div
                        className="gauge-pointer"
                        style={{ left: `${mq2ValPct}%` }}
                        title={`Hiện tại: ${curMq2} ADC`}
                      >
                        <div className="pointer-pin" />
                        <span className="pointer-tag">{curMq2}</span>
                      </div>
                    </div>
                    <div className="gauge-scale-labels">
                      <span>0 ADC (Trong sạch)</span>
                      <span className="scale-target-hint">
                        Ngưỡng trần an toàn: &lt; {currentTarget.maxMq2Adc} ADC
                      </span>
                      <span>3000 ADC (Đậm đặc)</span>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="inline-inputs-editor single-col">
                      <label>
                        Ngưỡng trần an toàn Gas MQ-2 (ADC):
                        <input
                          type="number"
                          value={editDraft.maxMq2Adc}
                          onChange={(e) => setEditDraft({ ...editDraft, maxMq2Adc: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* 4. THANH ĐO KHÍ ĐỘC CO MQ-7 */}
                <div className="visual-gauge-row">
                  <div className="gauge-header">
                    <div className="gauge-label-group">
                      <strong>Khí độc CO (MQ-7)</strong>
                      <span className="gauge-current-val">
                        Hiện tại: <b>{reading.sensors.mq7.adc_raw ?? '—'} ADC</b>
                      </span>
                    </div>
                    <span
                      className={`status-pill ${
                        scoreResult.coStatus === 'safe'
                          ? 'status-ok'
                          : scoreResult.coStatus === 'warning'
                            ? 'status-warn'
                            : 'status-danger'
                      }`}
                    >
                      {scoreResult.coStatus === 'safe'
                        ? '✓ Thoáng khí'
                        : scoreResult.coStatus === 'warning'
                          ? '⚠️ Cần lưu thông khí'
                          : '☠️ Nguy hiểm ngạt khí'}
                    </span>
                  </div>

                  <div className="gauge-track-wrap">
                    <div className="gauge-track">
                      <div
                        className="gauge-sweet-spot"
                        style={{
                          left: '0%',
                          width: `${mq7MaxPct}%`,
                        }}
                        title={`Ngưỡng an toàn: < ${currentTarget.maxMq7Adc} ADC`}
                      />
                      <div
                        className="gauge-pointer"
                        style={{ left: `${mq7ValPct}%` }}
                        title={`Hiện tại: ${curMq7} ADC`}
                      >
                        <div className="pointer-pin" />
                        <span className="pointer-tag">{curMq7}</span>
                      </div>
                    </div>
                    <div className="gauge-scale-labels">
                      <span>0 ADC (Không mùi)</span>
                      <span className="scale-target-hint">
                        Ngưỡng trần an toàn: &lt; {currentTarget.maxMq7Adc} ADC
                      </span>
                      <span>2500 ADC (Ngạt thở)</span>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="inline-inputs-editor single-col">
                      <label>
                        Ngưỡng trần an toàn Khí CO MQ-7 (ADC):
                        <input
                          type="number"
                          value={editDraft.maxMq7Adc}
                          onChange={(e) => setEditDraft({ ...editDraft, maxMq7Adc: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. SO SÁNH THỜI TIẾT NGOÀI TRỜI & TRONG NHÀ (FULL WIDTH) */}
      <OutdoorWeatherCard device={selectedDevice} />

      {/* 4. KHỐI TƯƠNG TÁC BÊN DƯỚI (2 CỘT): Điều khiển thiết bị ảo + Dòng thời gian 24h */}
      <div className="smart-bottom-grid">
        <SmartActuatorControls device={selectedDevice} />
        <HourlyTimelineView device={selectedDevice} />
      </div>
    </div>
  );
}
