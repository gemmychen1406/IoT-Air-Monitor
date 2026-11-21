import { useState } from 'react';
import type { DeviceView } from '@iot/contracts';
import { Fan, Droplets, Sliders, Zap, CheckCircle2, Bot } from 'lucide-react';
import type { SmartActuatorState } from './types.js';
import { defaultActuators, loadActuators, saveActuator } from './utils.js';

export default function SmartActuatorControls({ device }: { device: DeviceView }) {
  const [actuators, setActuators] = useState<SmartActuatorState>(
    () => loadActuators()[device.id] ?? defaultActuators,
  );
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  function toggleSwitch(key: Exclude<keyof SmartActuatorState, 'fanSpeed'>) {
    const nextVal = !actuators[key];
    const updated = { ...actuators, [key]: nextVal };
    setActuators(updated);
    saveActuator(device.id, updated);

    // Thông báo phản hồi mô phỏng IoT
    if (key === 'exhaustFan') {
      showNotice(
        nextVal
          ? `Đã kích hoạt Quạt hút thông gió tại ${device.name}. Dự kiến giảm nồng độ khí sau 3 phút.`
          : `Đã dừng Quạt hút thông gió tại ${device.name}.`,
      );
    } else if (key === 'dehumidifier') {
      showNotice(
        nextVal
          ? `Đã bật chế độ hút ẩm vi khí hậu tại ${device.name}.`
          : `Đã tắt máy hút ẩm tại ${device.name}.`,
      );
    } else if (key === 'autoPilot') {
      showNotice(
        nextVal
          ? `Đã bật chế độ Auto-Pilot tự động điều hòa môi trường theo tiêu chuẩn Eco-Score.`
          : `Đã chuyển sang chế độ điều khiển thủ công.`,
      );
    }
  }

  function showNotice(msg: string) {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 3500);
  }

  return (
    <div className="panel actuator-control-card">
      <div className="actuator-header">
        <div className="actuator-title-wrap">
          <div className="actuator-icon-box">
            <Zap size={18} />
          </div>
          <div>
            <h4>Trung tâm Điều khiển Tác nhân IoT (Smart Actuators)</h4>
            <small className="muted">
              Mô phỏng kích hoạt thiết bị xử lý môi trường tại {device.name}
            </small>
          </div>
        </div>

        {/* Chế độ Auto-Pilot */}
        <button
          className={`autopilot-pill ${actuators.autoPilot ? 'pilot-active' : ''}`}
          onClick={() => toggleSwitch('autoPilot')}
          title="Tự động bật quạt hút và điều hòa khi cảm biến vượt ngưỡng"
        >
          <Bot size={15} />
          <span>Auto-Pilot: {actuators.autoPilot ? 'TỰ ĐỘNG BẬT' : 'THỦ CÔNG'}</span>
        </button>
      </div>

      {actionNotice && (
        <div className="notice actuator-notice">
          <CheckCircle2 size={16} /> {actionNotice}
        </div>
      )}

      <div className="actuators-grid">
        {/* 1. Quạt hút thông gió */}
        <div className={`actuator-item ${actuators.exhaustFan ? 'active' : ''}`}>
          <div className="item-left">
            <div className={`fan-icon-wrap ${actuators.exhaustFan ? 'spinning' : ''}`}>
              <Fan size={22} />
            </div>
            <div className="item-info">
              <strong>Quạt hút thông gió</strong>
              <small>Xả khói, lưu thông khí tồn dư</small>
            </div>
          </div>
          <button
            className={`switch-btn ${actuators.exhaustFan ? 'switch-on' : ''}`}
            onClick={() => toggleSwitch('exhaustFan')}
          >
            {actuators.exhaustFan ? 'ĐANG CHẠY' : 'ĐANG TẮT'}
          </button>
        </div>

        {/* 2. Máy hút ẩm */}
        <div className={`actuator-item ${actuators.dehumidifier ? 'active' : ''}`}>
          <div className="item-left">
            <div className="actuator-icon-generic">
              <Droplets size={22} />
            </div>
            <div className="item-info">
              <strong>Máy hút ẩm thông minh</strong>
              <small>Cân bằng ẩm, ngăn nấm mốc</small>
            </div>
          </div>
          <button
            className={`switch-btn ${actuators.dehumidifier ? 'switch-on' : ''}`}
            onClick={() => toggleSwitch('dehumidifier')}
          >
            {actuators.dehumidifier ? 'ĐANG BẬT' : 'ĐANG TẮT'}
          </button>
        </div>

        {/* 3. Cửa sổ đối lưu tự động */}
        <div className={`actuator-item ${actuators.smartWindow ? 'active' : ''}`}>
          <div className="item-left">
            <div className="actuator-icon-generic">
              <Sliders size={22} />
            </div>
            <div className="item-info">
              <strong>Cửa sổ đối lưu tự động</strong>
              <small>Đón gió tươi khi trời mát</small>
            </div>
          </div>
          <button
            className={`switch-btn ${actuators.smartWindow ? 'switch-on' : ''}`}
            onClick={() => toggleSwitch('smartWindow')}
          >
            {actuators.smartWindow ? 'ĐANG MỞ' : 'ĐÃ ĐÓNG'}
          </button>
        </div>
      </div>
    </div>
  );
}
