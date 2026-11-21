/** Forecast from current API station readings; door and source settings are scenarios, not observed conditions. */
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { DoorClosed, DoorOpen, Info, Thermometer, Waves } from 'lucide-react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { absoluteHumidity, dewPoint } from './psychrometrics.js';
import type { SpreadDoors, SpreadEffect, SpreadRoom, SpreadStation } from './spreadForecast.js';
import { simulateSpread } from './spreadForecast.js';

type DisplayStation = SpreadStation & { valid: boolean; reason: string };
const COLORS = ['#f59e0b', '#38bdf8', '#a78bfa', '#2dd4bf', '#fb7185', '#84cc16', '#fb923c', '#c084fc', '#14b8a6'];
const ROOM_ORDER: readonly SpreadRoom[] = ['kitchen', 'living', 'bedroom', 'other'];
const ROOM_LABELS: Record<SpreadRoom, string> = {
  kitchen: 'Bếp', living: 'Phòng khách', bedroom: 'Phòng ngủ', other: 'Khu vực khác',
};
const fmt = (value: number, digits = 1) => value.toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDelta = (value: number, unit: string) => `${value >= 0 ? '+' : ''}${fmt(value, 2)} ${unit}`;
const unit = { temperature: '°C', humidity: '%RH' } as const;

/**
 * Room-first presentation like the earlier 4-room proof of concept, but without
 * inventing extra rooms or measurements: only the user-selected system stations.
 */
export function SpreadScenarioPanel({ stations }: { stations: readonly DisplayStation[] }) {
  const [source, setSource] = useState('');
  const [effect, setEffect] = useState<SpreadEffect>('heat');
  const [doors, setDoors] = useState<SpreadDoors>({ kitchenLiving: false, livingBedroom: false });
  const [minutes, setMinutes] = useState<15 | 30>(15);
  const [metric, setMetric] = useState<'temperature' | 'humidity'>('temperature');
  const valid = stations.filter(station => station.valid);
  const sourceId = valid.some(station => station.id === source) ? source : (valid[0]?.id ?? '');
  const forecast = useMemo(() => simulateSpread(valid, { sourceId, effect, doors, minutes }), [valid, sourceId, effect, doors, minutes]);
  if (stations.length < 2) {
    return <div role="status" className="panel ft-spread-state">Hãy chọn ít nhất 2 trạm để dự báo lan truyền nhiệt và hơi ẩm.</div>;
  }
  if (valid.length < 2) {
    return <div role="status" className="panel ft-spread-state">Cần ít nhất 2 trạm có mẫu DHT11 mới, hợp lệ để tính kịch bản. Không dùng số liệu giả thay thế.</div>;
  }

  const final = forecast.frames.at(-1);
  const starting = forecast.frames[0];
  const sourceStation = valid.find(station => station.id === sourceId);
  const graphData = forecast.frames.map(frame => {
    const point: Record<string, number> = { minute: frame.minute };
    frame.stations.forEach((station, index) => { point[`v${index}`] = station[metric]; });
    return point;
  });
  const setDoor = (key: keyof SpreadDoors, open: boolean) => setDoors(old => ({ ...old, [key]: open }));
  const visibleRooms = ROOM_ORDER.filter(room => valid.some(station => station.room === room));

  // Compare each directly relevant doorway using identical starting readings.
  // No sensor readings are modified or written back to the common API.
  const doorComparisons = ([
    { key: 'kitchenLiving', label: 'Bếp – Phòng khách', from: 'kitchen', to: 'living' },
    { key: 'livingBedroom', label: 'Phòng khách – Phòng ngủ', from: 'living', to: 'bedroom' },
  ] as const).flatMap(edge => {
    if (!sourceStation || (sourceStation.room !== edge.from && sourceStation.room !== edge.to)) return [];
    const targetRoom = sourceStation.room === edge.from ? edge.to : edge.from;
    const candidateStations = valid.filter(station => station.room === targetRoom);
    if (!candidateStations.length) return [];
    const open = simulateSpread(valid, { sourceId, effect, doors: { ...doors, [edge.key]: true }, minutes }).frames.at(-1);
    const closed = simulateSpread(valid, { sourceId, effect, doors: { ...doors, [edge.key]: false }, minutes }).frames.at(-1);
    const readings = candidateStations.flatMap(station => {
      const a = open?.stations.find(item => item.id === station.id);
      const b = closed?.stations.find(item => item.id === station.id);
      return a && b ? [{ name: station.name, temperature: a.temperature - b.temperature, humidity: a.humidity - b.humidity }] : [];
    });
    const strongest = readings.sort((a, b) =>
      (Math.abs(b.temperature) + Math.abs(b.humidity) * 0.1) - (Math.abs(a.temperature) + Math.abs(a.humidity) * 0.1))[0];
    return strongest ? [{ ...strongest, label: edge.label }] : [];
  });

  return <>
    {stations.some(station => !station.valid) ? <div className="ft-info"><Info size={16} /> Trạm có số đo lỗi, ngoại tuyến hoặc quá cũ được bỏ qua: {stations.filter(station => !station.valid).map(station => station.name).join(', ')}.</div> : null}
    <section className="panel ft-spread-panel">
      <div className="ft-section-bar"><div>
        <h2><Waves size={20} /> Dự báo lan truyền nhiệt & hơi ẩm</h2>
        <p className="ft-muted">Từ số đo DHT11 mới nhất của {valid.length} trạm; thử nguồn nhiệt/ẩm và trạng thái cửa để xem ảnh hưởng sau 15–30 phút.</p>
      </div><span className="ft-micro-tag">Dự báo theo kịch bản</span></div>
      <div className="ft-spread-note" role="note"><Info size={17}/><span><strong>Lưu ý:</strong> Số đo ban đầu lấy từ hệ thống; trạng thái cửa, nguồn nhiệt/ẩm tiếp tục hoạt động và hệ số trao đổi là các giả định của mô hình. Kết quả chưa được kiểm chứng bằng số đo ở thời điểm tương lai.</span></div>

      <div className="ft-spread-controls ft-spread-main-controls">
        <label>Trạm phát sinh thay đổi
          <select value={sourceId} onChange={(e: ChangeEvent<HTMLSelectElement>) => setSource(e.target.value)}>
            {valid.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}
          </select>
        </label>
        <label>Giả định nguồn tiếp tục hoạt động
          <select value={effect} onChange={(e: ChangeEvent<HTMLSelectElement>) => setEffect(e.target.value as SpreadEffect)}>
            <option value="none">Ngừng phát nhiệt/ẩm – chỉ trao đổi từ mức hiện tại</option>
            <option value="heat">Tiếp tục tỏa nhiệt (+0,18°C/phút tại trạm nguồn)</option>
            <option value="moisture">Tiếp tục tạo hơi ẩm (+0,09 g/m³/phút)</option>
            <option value="both">Tiếp tục tỏa nhiệt và tạo hơi ẩm</option>
          </select>
        </label>
      </div>
      <div className="ft-door-grid ft-spread-door-controls" aria-label="Trạng thái cửa giả định">
        <label className="ft-door-item"><span>{doors.kitchenLiving ? <DoorOpen size={17}/> : <DoorClosed size={17}/>} Cửa Bếp – Phòng khách</span>
          <select value={doors.kitchenLiving ? 'open' : 'closed'} onChange={e => setDoor('kitchenLiving', e.target.value === 'open')}>
            <option value="closed">Cửa đóng (trao đổi chậm)</option><option value="open">Cửa mở (trao đổi nhanh)</option>
          </select>
        </label>
        <label className="ft-door-item"><span>{doors.livingBedroom ? <DoorOpen size={17}/> : <DoorClosed size={17}/>} Cửa Phòng khách – Phòng ngủ</span>
          <select value={doors.livingBedroom ? 'open' : 'closed'} onChange={e => setDoor('livingBedroom', e.target.value === 'open')}>
            <option value="closed">Cửa đóng (trao đổi chậm)</option><option value="open">Cửa mở (trao đổi nhanh)</option>
          </select>
        </label>
      </div>
      <div className="ft-spread-toolbar">
        <div className="ft-spread-time"><strong>Mốc dự báo</strong>{([15,30] as const).map(n => <button key={n} type="button" className={minutes === n ? 'active' : ''} onClick={() => setMinutes(n)}>Sau {n} phút</button>)}</div>
        <span className="ft-muted">Mặc định: cửa đóng, nguồn tỏa nhiệt; bạn có thể thay đổi để so sánh.</span>
      </div>

      <div className="ft-micro-result-heading"><h3>Ước lượng sau {minutes} phút</h3><span className="ft-muted">Mỗi phòng gồm các trạm đang chọn, không tạo thêm trạm giả.</span></div>
      <div className="ft-spread-room-grid">
        {visibleRooms.map(room => {
          const roomStations = valid.filter(station => station.room === room);
          const isSourceRoom = roomStations.some(station => station.id === sourceId);
          return <section key={room} className={`ft-spread-room ${isSourceRoom ? 'ft-spread-room-source' : ''}`} aria-label={ROOM_LABELS[room]}>
            <div className="ft-micro-room-heading"><strong>{ROOM_LABELS[room]}</strong>{isSourceRoom ? <span>Phòng có trạm nguồn</span> : null}</div>
            {roomStations.map(station => {
              const result = final?.stations.find(item => item.id === station.id);
              const initial = starting?.stations.find(item => item.id === station.id);
              if (!result || !initial) return null;
              const absolute = absoluteHumidity(result.temperature, result.humidity);
              const dew = dewPoint(result.temperature, result.humidity);
              return <article key={station.id} className={`ft-spread-room-station ${station.id === sourceId ? 'ft-spread-room-station-source' : ''}`}>
                <div className="ft-spread-card-top"><strong>{station.name}</strong>{station.id === sourceId ? <span>Trạm nguồn</span> : null}</div>
                <small>Hiện tại: {fmt(initial.temperature)}°C · {fmt(initial.humidity)}%RH</small>
                <div className="ft-micro-prediction"><Thermometer size={15}/>{fmt(result.temperature)}°C <span>{fmtDelta(result.deltaTemperature, '°C')}</span></div>
                <div className="ft-micro-prediction"><Waves size={15}/>{fmt(result.humidity)}%RH <span>{fmtDelta(result.deltaHumidity, 'điểm %RH')}</span></div>
                {absolute !== null && dew !== null ? <small>Hơi nước: {fmt(absolute, 2)} g/m³ · Điểm sương: {fmt(dew)}°C</small> : null}
              </article>;
            })}
          </section>;
        })}
      </div>
      {forecast.links === 0 ? <div className="ft-info"><Info size={16}/> Các trạm đang chọn chưa có đường nối trong sơ đồ giả định. Hãy chọn thêm trạm trung gian để tính ảnh hưởng liên phòng.</div> : null}
      {doorComparisons.map(comparison => <div key={comparison.label} className="ft-spread-door-result"><DoorOpen size={18}/><span><strong>Cửa {comparison.label}:</strong> khi mở so với đóng, kết quả tại <strong>{comparison.name}</strong> chênh lệch {fmtDelta(comparison.temperature, '°C')} và {fmtDelta(comparison.humidity, 'điểm %RH')} sau {minutes} phút.</span></div>)}
    </section>
    <section className="panel ft-chart-panel ft-wide-panel">
      <div className="ft-section-bar"><div><h2>Diễn biến ước lượng từ hiện tại đến +{minutes} phút</h2><p className="ft-muted">Mốc 0 là số đo hiện tại, các mốc +5 phút trở đi do mô hình tính.</p></div>
        <div className="ft-switch-metric"><button type="button" className={metric === 'temperature' ? 'active' : ''} onClick={() => setMetric('temperature')}>Nhiệt độ</button><button type="button" className={metric === 'humidity' ? 'active' : ''} onClick={() => setMetric('humidity')}>Độ ẩm</button></div>
      </div>
      <div className="ft-chart ft-chart-many" role="img" aria-label={`Đồ thị ước lượng ${metric === 'temperature' ? 'nhiệt độ' : 'độ ẩm'} của các trạm`}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={graphData} margin={{ top: 12, right: 15, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false}/>
          <XAxis dataKey="minute" type="number" domain={[0, minutes]} ticks={minutes === 15 ? [0,5,10,15] : [0,5,10,15,20,25,30]} stroke="var(--muted)" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `+${v}'`}/>
          <YAxis domain={['auto','auto']} width={55} stroke="var(--muted)" tick={{ fontSize: 11 }} unit={unit[metric]}/>
          <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }} labelFormatter={(v: unknown) => `Sau ${String(v)} phút`} formatter={(v: unknown, name: unknown) => [typeof v === 'number' ? `${fmt(v,2)} ${unit[metric]}` : '—', String(name)]}/>
          <Legend/>
          {valid.map((station, index) => <Line key={station.id} type="monotone" dataKey={`v${index}`} name={station.name} stroke={COLORS[index % COLORS.length]} strokeWidth={2.3} dot={false} isAnimationActive={false}/>) }
        </LineChart></ResponsiveContainer>
      </div>
    </section>
  </>;
}
