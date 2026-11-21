// [FORECAST - FILE MOI] Giao dien rieng cua module Phan tich xu huong & Du bao.
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FORECAST_CONFIG as CFG } from './config.js';
import { walkForward, validationTrace } from './validation.js';
import type { ForecastModel, Measure, MinuteReading } from './types.js';

const meta = {
  temperature: { name: 'Nhiệt độ', unit: '°C' },
  humidity: { name: 'Độ ẩm', unit: '%RH' },
} as const;
const metrics: readonly Measure[] = ['temperature', 'humidity'];
const models: ForecastModel[] = ['naive', 'linear', 'holt'];
const modelLabel: Record<ForecastModel, string> = { naive: 'Giữ giá trị cuối', linear: 'Hồi quy tuyến tính', holt: 'Holt' };
const formatMAE = (mae: number | null, count: number, unit: string) =>
  mae === null || count < CFG.validationMinimumPairs ? `Chưa đủ (${count}/${CFG.validationMinimumPairs})` : `${mae.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${unit} · ${count} lần`;

export function ForecastValidationPanel({ history, horizon, model }: {
  history: readonly MinuteReading[];
  horizon: 15 | 30;
  model: ForecastModel;
}) {
  const [metric, setMetric] = useState<Measure>('temperature');
  const all = useMemo(() => ({
    temperature: walkForward(history, 'temperature', horizon),
    humidity: walkForward(history, 'humidity', horizon),
  }), [history, horizon]);
  const trace = useMemo(
    () => validationTrace(history, metric, model, horizon),
    [history, metric, model, horizon],
  );
  const enough = all[metric].find((row) => row.model === model)?.pairs ?? 0;
  const best = metrics.flatMap((key) => {
    const ranked = all[key].filter((row) => row.mae !== null && row.pairs >= CFG.validationMinimumPairs)
      .sort((a, b) => a.mae! - b.mae!);
    return ranked[0] ? [{ metric: key, model: ranked[0].model }] : [];
  });

  return <div className="ft-validation">
    <section className="panel ft-instructions">
      <h2>Kiểm chứng dự báo có sát thực tế không?</h2>
      <p>Hệ thống chọn các thời điểm trong quá khứ, chỉ dùng số đo <strong>trước thời điểm đó</strong> để dự báo {horizon} phút, rồi so với giá trị thực tế đo được sau đó.</p>
      <p><strong>MAE</strong> là sai số tuyệt đối trung bình; số càng nhỏ thì dự báo càng sát trên tập dữ liệu kiểm thử. Kết quả chỉ hiển thị khi có ít nhất {CFG.validationMinimumPairs} lần đối chiếu hợp lệ.</p>
    </section>
    <section className="panel ft-validation-table">
      <div className="ft-section-bar"><h2>So sánh ba thuật toán</h2><span className="ft-muted">Dự báo {horizon} phút · cùng mốc kiểm thử cho cả ba thuật toán</span></div>
      <div className="ft-table-scroll"><table><thead><tr><th>Mô hình</th>{metrics.map((key) => <th key={key}>{meta[key].name}<small>{meta[key].unit}</small></th>)}</tr></thead>
        <tbody>{models.map((name) => <tr key={name} className={name === model ? 'ft-table-selected' : ''}>
          <th>{modelLabel[name]}</th>{metrics.map((key) => {
            const item = all[key].find((row) => row.model === name)!;
            return <td key={key}>{formatMAE(item.mae, item.pairs, meta[key].unit)}</td>;
          })}
        </tr>)}</tbody></table></div>
      {best.length ? <p className="ft-muted">Sai số thấp nhất (trên những mô hình đủ dữ liệu): {best.map((item) => `${meta[item.metric].name}: ${modelLabel[item.model]}`).join(' · ')}. Không có thuật toán nào luôn tốt nhất trên mọi dữ liệu.</p> : <p className="ft-muted">Chưa có đủ cặp dự báo–đo thực tế để kết luận mô hình nào chính xác hơn.</p>}
    </section>
    <section className="panel ft-chart-panel ft-wide-panel">
      <div className="ft-section-bar"><div><h2>Biểu đồ đối chiếu dự báo và số đo</h2><p className="ft-muted">Màu xanh: thực tế · màu tím: dự báo từ thời điểm trước đó</p></div>
        <label>Chỉ số <select value={metric} onChange={(event: ChangeEvent<HTMLSelectElement>) => setMetric(event.target.value as Measure)}>
          {metrics.map((key) => <option key={key} value={key}>{meta[key].name}</option>)}
        </select></label>
      </div>
      {trace.length ? <div className="ft-chart ft-chart-large" role="img" aria-label="Biểu đồ so sánh dự báo lịch sử và giá trị thực tế">
        <ResponsiveContainer width="100%" height="100%"><LineChart data={trace} margin={{ top: 14, right: 10, bottom: 10, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false}/>
          <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => new Date(value).toLocaleTimeString('vi-VN', {hour:'2-digit',minute:'2-digit'})} tick={{fontSize:11}} minTickGap={50}/>
          <YAxis domain={[0, metric === 'humidity' ? 100 : 'auto']} tick={{fontSize:11}} width={50}/>
          <Tooltip labelFormatter={(value: unknown) => typeof value === 'number' ? new Date(value).toLocaleString('vi-VN') : ''}
            formatter={(value: unknown) => typeof value === 'number' ? `${value.toFixed(2)} ${meta[metric].unit}` : '—'}
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 9 }}/><Legend/>
          <Line dataKey="actual" name="Số đo thực tế" stroke="#38bdf8" strokeWidth={2.2} dot={false} isAnimationActive={false}/>
          <Line dataKey="prediction" name="Dự báo lịch sử" stroke="#a78bfa" strokeDasharray="6 4" strokeWidth={2.2} dot={false} isAnimationActive={false}/>
        </LineChart></ResponsiveContainer>
      </div> : <div className="ft-empty">Chưa có đủ dữ liệu để vẽ biểu đồ đối chiếu này.</div>}
      <p className="ft-muted">{meta[metric].name} · {modelLabel[model]} · {enough >= CFG.validationMinimumPairs ? `${enough} lần đối chiếu hợp lệ` : `Chỉ có ${enough} lần đối chiếu, chưa đủ để công bố MAE đáng tin cậy`}.</p>
    </section>
  </div>;
}
