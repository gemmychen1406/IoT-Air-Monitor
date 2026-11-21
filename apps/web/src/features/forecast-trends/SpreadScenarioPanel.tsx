/** Forecast panel, driven only by existing API readings. Scenario inputs never write data to the API. */
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ArrowRight, DoorOpen, Info, Thermometer, Waves } from 'lucide-react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { SpreadDoors, SpreadEffect, SpreadStation } from './spreadForecast.js';
import { simulateSpread } from './spreadForecast.js';

type DisplayStation = SpreadStation & { valid: boolean; reason: string };
const COLORS = ['#f59e0b', '#38bdf8', '#a78bfa', '#2dd4bf', '#fb7185', '#84cc16', '#fb923c', '#c084fc', '#14b8a6'];
const fmt = (value: number, digits = 1) => value.toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDelta = (value: number, unit: string) => `${value >= 0 ? '+' : ''}${fmt(value, 2)} ${unit}`;
const unit = { temperature: '°C', humidity: '%RH' } as const;

export function SpreadScenarioPanel({ stations }: { stations: readonly DisplayStation[] }) {
  const [source, setSource] = useState('');
  const [effect, setEffect] = useState<SpreadEffect>('heat');
  const [doors, setDoors] = useState<SpreadDoors>({ kitchenLiving: false, livingBedroom: false });
  const [minutes, setMinutes] = useState<15 | 30>(15);
  const [metric, setMetric] = useState<'temperature' | 'humidity'>('temperature');
  const valid = stations.filter(s => s.valid);
  const sourceId = valid.some(s => s.id === source) ? source : (valid[0]?.id ?? '');
  const forecast = useMemo(() => simulateSpread(valid, { sourceId, effect, doors, minutes }), [valid, sourceId, effect, doors, minutes]);
  if (stations.length < 2) {
    return <div role="status" className="panel ft-spread-state">Cần ít nhất 2 trạm được chọn để tính kịch bản lan truyền.</div>;
  }
  if (valid.length < 2) {
    return <div role="status" className="panel ft-spread-state">Chưa đủ 2 trạm có mẫu DHT11 hợp lệ và mới (không quá 5 phút). Hãy kiểm tra trạng thái thiết bị hoặc chọn trạm khác. Không tạo giá trị đo giả để thay thế.</div>;
  }
  const final = forecast.frames.at(-1);
  const starting = forecast.frames[0];
  const sourceStation = valid.find(s => s.id === sourceId);
  const graphData = forecast.frames.map(frame => {
    const point: Record<string, number> = { minute: frame.minute };
    frame.stations.forEach((station, index) => { point[`v${index}`] = station[metric]; });
    return point;
  });
  const affected = final?.stations.filter(s => s.id !== sourceId).sort((a, b) => Math.abs(b.deltaTemperature) - Math.abs(a.deltaTemperature))[0];
  const affectedName = valid.find(s => s.id === affected?.id)?.name;
  const setDoor = (key: keyof SpreadDoors, open: boolean) => setDoors(old => ({ ...old, [key]: open }));
  const hasBothSides = valid.some(s => s.room === 'kitchen') && valid.some(s => s.room === 'living');
  const doorComparison = hasBothSides ? (() => {
    const open = simulateSpread(valid, { sourceId, effect, doors: { ...doors, kitchenLiving: true }, minutes }).frames.at(-1);
    const closed = simulateSpread(valid, { sourceId, effect, doors: { ...doors, kitchenLiving: false }, minutes }).frames.at(-1);
    const sourceRoom = valid.find(s => s.id === sourceId)?.room;
    const candidates = valid.filter(s => sourceRoom === 'kitchen' ? s.room === 'living' : s.room === 'kitchen');
    const differences = candidates.flatMap(s => {
      const a = open?.stations.find(v => v.id === s.id);
      const b = closed?.stations.find(v => v.id === s.id);
      return a && b ? [{ name: s.name, change: a.temperature - b.temperature }] : [];
    }).sort((a,b) => Math.abs(b.change) - Math.abs(a.change));
    return differences[0] ?? null;
  })() : null;
  return <>
    {stations.some(s => !s.valid) ? <div className="ft-info"><Info size={16} /> Các trạm có dữ liệu không hợp lệ, ngoại tuyến hoặc quá cũ được bỏ qua: {stations.filter(s => !s.valid).map(s => s.name).join(', ')}.</div> : null}
    <section className="panel ft-spread-panel">
      <div className="ft-section-bar"><div>
        <h2><Waves size={20} /> Dự báo lan truyền nhiệt & hơi ẩm</h2>
        <p className="ft-muted">Điểm xuất phát: số đo mới nhất từ {valid.length} trạm hệ thống. Chọn trạm nguồn, trạng thái cửa và xem ước lượng sau 15–30 phút.</p>
      </div><span className="ft-micro-tag">Kịch bản có giả định, không phải đo tương lai</span></div>
      <div className="ft-spread-controls">
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
        <label><DoorOpen size={15}/> Cửa Bếp ↔ Phòng khách
          <select value={doors.kitchenLiving ? 'open' : 'closed'} onChange={e => setDoor('kitchenLiving', e.target.value === 'open')}>
            <option value="closed">Đóng – trao đổi chậm</option><option value="open">Mở – trao đổi nhanh</option>
          </select>
        </label>
        <label><DoorOpen size={15}/> Cửa Phòng khách ↔ Phòng ngủ
          <select value={doors.livingBedroom ? 'open' : 'closed'} onChange={e => setDoor('livingBedroom', e.target.value === 'open')}>
            <option value="closed">Đóng – trao đổi chậm</option><option value="open">Mở – trao đổi nhanh</option>
          </select>
        </label>
      </div>
      <div className="ft-spread-toolbar">
        <div className="ft-spread-time"><strong>Mốc dự báo</strong>{([15,30] as const).map(n => <button key={n} type="button" className={minutes === n ? 'active' : ''} onClick={() => setMinutes(n)}>Sau {n} phút</button>)}</div>
        <p>Trạm có đo đạc thật từ API; trạng thái cửa, cấu trúc nối phòng và cường độ nguồn nhiệt/ẩm là <strong>giả định bạn chọn</strong>.</p>
      </div>
      <div className="ft-spread-grid">
        {final?.stations.map((reading, index) => {
          const station = valid.find(s => s.id === reading.id)!;
          const initial = starting?.stations.find(s => s.id === reading.id)!;
          return <article key={station.id} className={`ft-spread-card ${reading.id === sourceId ? 'ft-spread-source' : ''}`} style={{ borderTopColor: COLORS[index % COLORS.length] }}>
            <div className="ft-spread-card-top"><strong>{station.name}</strong>{station.id === sourceId ? <span>Trạm nguồn</span> : null}</div>
            <small>Hiện tại đo được: {fmt(initial.temperature)}°C · {fmt(initial.humidity)}%RH</small>
            <div className="ft-spread-reading"><Thermometer size={17}/>{fmt(reading.temperature)}°C <span>{fmtDelta(reading.deltaTemperature, '°C')}</span></div>
            <div className="ft-spread-reading"><Waves size={17}/>{fmt(reading.humidity)}%RH <span>{fmtDelta(reading.deltaHumidity, 'điểm %RH')}</span></div>
          </article>;
        })}
      </div>
      {forecast.links === 0 ? <div className="ft-info"><Info size={16}/> Các trạm đã chọn không có liên kết trong sơ đồ giả định. Hãy chọn thêm trạm trung gian (ví dụ Phòng khách giữa Bếp và Phòng ngủ) để mô hình có đường lan truyền.</div> : null}
      {doorComparison && Math.abs(doorComparison.change) >= 0.01 ? <div className="ft-spread-door-result"><DoorOpen size={18}/><span><strong>Ảnh hưởng cửa Bếp – Khách:</strong> tại {doorComparison.name}, trường hợp cửa mở so với đóng có chênh lệch dự kiến {fmtDelta(doorComparison.change, '°C')} sau {minutes} phút. Đây là so sánh hai giả định của mô hình, không phải số đo thực tế.</span></div> : null}
      {affected && affectedName ? <div className="ft-micro-comment"><ArrowRight size={18}/><span>Ví dụ diễn giải: Với nguồn <strong>{sourceStation?.name}</strong> và trạng thái cửa đang chọn, mô hình ước lượng <strong>{affectedName}</strong> thay đổi {fmtDelta(affected.deltaTemperature, '°C')} sau {minutes} phút. Đây không phải bằng chứng nhiệt đã thực sự lan tới trạm đó.</span></div> : null}
    </section>
    <section className="panel ft-chart-panel ft-wide-panel">
      <div className="ft-section-bar"><div><h2>Đường dự báo từ hiện tại đến +{minutes} phút</h2><p className="ft-muted">Từng đường là một trạm. Phút 0 là số đo hiện tại; các phút sau là kết quả tính theo mô hình giả định.</p></div>
        <div className="ft-switch-metric"><button type="button" className={metric === 'temperature' ? 'active' : ''} onClick={() => setMetric('temperature')}>Nhiệt độ</button><button type="button" className={metric === 'humidity' ? 'active' : ''} onClick={() => setMetric('humidity')}>Độ ẩm</button></div>
      </div>
      <div className="ft-chart ft-chart-many" role="img" aria-label={`Đồ thị dự báo ${metric === 'temperature' ? 'nhiệt độ' : 'độ ẩm'} của các trạm`}>
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
    <div className="ft-info"><Info size={16} /> Mô hình cân bằng rời rạc theo phút: trao đổi nhiệt độ và <strong>độ ẩm tuyệt đối</strong> giữa các trạm trong phòng, qua cửa giữa các phòng. Độ ẩm tương đối (%RH) được tính lại theo nhiệt độ dự báo. Hệ số trao đổi, liên kết trạm và mức tỏa nhiệt chưa hiệu chuẩn; kịch bản cửa mở cho trao đổi nhanh hơn cửa đóng. Không có cảm biến cửa, nên chương trình <strong>không biết trạng thái cửa thực tế</strong>. Kết quả chỉ để minh họa, không dùng thay số đo hoặc kết luận nguy hiểm.</div>
  </>;
}
