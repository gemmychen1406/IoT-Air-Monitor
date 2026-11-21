// [FORECAST - FILE MOI] Giao dien rieng cua module Phan tich xu huong & Du bao.
import type { ChangeEvent } from 'react';
import { AirVent, DoorClosed, DoorOpen, Droplets, Info, Thermometer } from 'lucide-react';
import { absoluteHumidity, dewPoint } from './psychrometrics.js';
import { DEMO_ROOMS } from './demoScenario.js';
import type { DemoScenario } from './demoScenario.js';
import { MICROCLIMATE_LINKS } from './microclimate.js';
import type { DoorId, DoorStates } from './microclimate.js';

const f = (number: number, digits = 1) => number.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** All calculations in this panel are conditional on assumptions, not sensor evidence. */
export function MicroclimateScenarioPanel({ demo, doors, onDoorsChange, horizon }: {
  demo: DemoScenario;
  doors: DoorStates;
  onDoorsChange: (value: DoorStates) => void;
  horizon: 15 | 30;
}) {
  const observed = demo.projection[0]!;
  const projected = demo.projection[horizon]!;
  const isMoisture = demo.metric === 'humidity';
  const changedRooms = DEMO_ROOMS.filter((room) => {
    const current = observed.rooms[room.id];
    const future = projected.rooms[room.id];
    return Math.abs(isMoisture ? future.absoluteHumidity - current.absoluteHumidity : future.temperature - current.temperature) >= (isMoisture ? 0.35 : 0.3);
  });
  const linkedToSource = MICROCLIMATE_LINKS.filter((edge) => edge.a === demo.sourceId || edge.b === demo.sourceId);
  return <section className="panel ft-micro-model">
    <div className="ft-section-bar">
      <div><h2><AirVent size={20} /> Mô hình trao đổi nhiệt & hơi ẩm</h2>
        <p className="ft-muted">Bốn phòng là bốn nút; cửa nối các phòng điều chỉnh hệ số trao đổi giả định.</p></div>
      <span className="ft-micro-tag">Chỉ trong chế độ thử nghiệm</span>
    </div>
    <div className="ft-door-grid" aria-label="Trạng thái cửa giả định">
      {MICROCLIMATE_LINKS.map((edge) => <label key={edge.id} className="ft-door-item">
        <span>{doors[edge.id] ? <DoorOpen size={17} /> : <DoorClosed size={17} />} {edge.label}</span>
        <select value={doors[edge.id] ? 'open' : 'closed'} onChange={(e: ChangeEvent<HTMLSelectElement>) => onDoorsChange({ ...doors, [edge.id as DoorId]: e.target.value === 'open' })}>
          <option value="open">Cửa mở (trao đổi mạnh)</option>
          <option value="closed">Cửa đóng (trao đổi yếu)</option>
        </select>
      </label>)}
    </div>
    <div className="ft-micro-result-heading"><h3>Ước lượng sau {horizon} phút</h3><span className="ft-muted">Từ trạng thái mô phỏng phút hiện tại, giữ nguyên các giả định của kịch bản</span></div>
    <div className="ft-micro-result-grid">
      {DEMO_ROOMS.map((room) => {
        const start = observed.rooms[room.id];
        const end = projected.rooms[room.id];
        const dT = end.temperature - start.temperature;
        const dAH = end.absoluteHumidity - start.absoluteHumidity;
        const significant = isMoisture ? Math.abs(dAH) >= 0.35 : Math.abs(dT) >= 0.3;
        return <article className={`ft-micro-result ${significant ? 'ft-micro-affected' : ''}`} key={room.id}>
          <div className="ft-micro-room-heading"><strong>{room.name}</strong>{room.id === demo.sourceId ? <span>Nơi phát sinh</span> : significant ? <span>Có thay đổi dự kiến</span> : null}</div>
          <div className="ft-micro-prediction"><Thermometer size={15}/>{f(end.temperature)}°C <span>{dT >= 0 ? '+' : ''}{f(dT, 2)}°C</span></div>
          <div className="ft-micro-prediction"><Droplets size={15}/>{f(end.humidity)}%RH <span>{dAH >= 0 ? '+' : ''}{f(dAH, 2)} g/m³</span></div>
          <small>Hơi nước: {f(end.absoluteHumidity, 2)} g/m³ · Điểm sương: {f(dewPoint(end.temperature, end.humidity) ?? 0)}°C</small>
        </article>;
      })}
    </div>
    <div className="ft-micro-comment">
      <Info size={17} />
      <span>
        {changedRooms.length >= 2 ? `Theo mô hình giả định, ${changedRooms.length} phòng có biến động đáng kể trong ${horizon} phút.` : 'Theo mô hình giả định, ảnh hưởng đến các phòng khác còn nhỏ trong khoảng thời gian chọn.'}
        {' '}Nguồn giả định: {DEMO_ROOMS.find((room) => room.id === demo.sourceId)?.name}; {linkedToSource.some((edge) => doors[edge.id]) ? 'có đường thông khí trực tiếp đang mở.' : 'các cửa nối trực tiếp đang đóng.'}
      </span>
    </div>
    <p className="ft-muted">Nhiệt độ và %RH trong chế độ này được sinh từ mô hình cân bằng rời rạc với hệ số chưa hiệu chỉnh, thể tích phòng giả định tương đương và nguồn nhiệt/ẩm giả định. Độ ẩm tuyệt đối, điểm sương là giá trị <strong>tính toán</strong>, không phải cảm biến riêng. Đổi trạng thái cửa sẽ tạo lại toàn bộ kịch bản thử nghiệm, không phải điều khiển cửa thật.</p>
  </section>;
}

export function MoistureIndicators({ temperature, humidity }: { temperature: number | null; humidity: number | null }) {
  const absolute = temperature !== null && humidity !== null ? absoluteHumidity(temperature, humidity) : null;
  const dew = temperature !== null && humidity !== null ? dewPoint(temperature, humidity) : null;
  return <section className="ft-psychrometrics" aria-label="Các chỉ số độ ẩm tính toán">
    <div><span>Độ ẩm tuyệt đối</span><strong>{absolute !== null ? `${f(absolute, 2)} g/m³` : '—'}</strong><small>Lượng hơi nước ước tính trong một mét khối không khí</small></div>
    <div><span>Điểm sương</span><strong>{dew !== null ? `${f(dew)}°C` : '—'}</strong><small>Nhiệt độ có thể bắt đầu ngưng tụ khi làm lạnh không khí</small></div>
  </section>;
}
