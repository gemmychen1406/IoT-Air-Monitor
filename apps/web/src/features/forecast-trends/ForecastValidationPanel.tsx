// [FORECAST - FILE MOI] Giao dien rieng cua module Phan tich xu huong & Du bao.
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FORECAST_CONFIG as CFG } from './config.js';
import { walkForward, validationTrace } from './validation.js';
import { compareAdvancedCurves } from './curveValidation.js';
import type { ForecastModel, Measure, MinuteReading } from './types.js';

const meta = {
  temperature: { name: 'Nhiệt độ', unit: '°C' },
  humidity: { name: 'Độ ẩm', unit: '%RH' },
} as const;
const metrics: readonly Measure[] = ['temperature', 'humidity'];
const models: ForecastModel[] = ['naive', 'linear', 'holt'];
const extraModels: ForecastModel[] = ['random_forest', 'holt_winters'];
const modelLabel: Record<ForecastModel, string> = { naive: 'Giữ giá trị cuối', linear: 'Hồi quy tuyến tính', holt: 'Holt', random_forest: 'Random Forest', holt_winters: 'Holt-Winters' };
const formatMAE = (mae: number | null, count: number, unit: string, minimum = CFG.validationMinimumPairs) =>
  mae === null || count < minimum ? `Chưa đủ (${count}/${minimum})` : `${mae.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${unit} · ${count} lần`;

export function ForecastValidationPanel({ history, horizon, model }: {
  history: readonly MinuteReading[];
  horizon: 15 | 30;
  model: Record<Measure, ForecastModel>;
}) {
  const [metric, setMetric] = useState<Measure>('temperature');
  const all = useMemo(() => ({
    temperature: walkForward(history, 'temperature', horizon, undefined, { multiStep: true }),
    humidity: walkForward(history, 'humidity', horizon, undefined, { multiStep: true }),
  }), [history, horizon]);
  const advanced = useMemo(() => Object.fromEntries(metrics.map((key) => [key,
    Object.fromEntries(extraModels.map((name) => {
      const kind = name as 'random_forest' | 'holt_winters';
      const recent = compareAdvancedCurves(history, key, horizon, kind, 20, 50);
      return [name, recent.pairs >= 8 ? recent : compareAdvancedCurves(history, key, horizon, kind, 40)];
    })),
  ])) as Record<Measure, Record<'random_forest' | 'holt_winters', ReturnType<typeof compareAdvancedCurves>>>, [history, horizon]);
  const selectedModel = model[metric];
  const trace = useMemo(
    () => validationTrace(history, metric, selectedModel, horizon),
    [history, metric, selectedModel, horizon],
  );
  const enough = all[metric].find((row) => row.model === selectedModel)?.pairs ??
    (selectedModel === 'random_forest' || selectedModel === 'holt_winters' ? advanced[metric][selectedModel].pairs : 0);
  const best = metrics.flatMap((key) => {
    const ranked = all[key].filter((row) => row.mae !== null && row.pairs >= CFG.validationMinimumPairs)
      .sort((a, b) => a.mae! - b.mae!);
    return ranked[0] ? [{ metric: key, model: ranked[0].model }] : [];
  });

  return <div className="ft-validation">
    <section className="panel ft-instructions">
      <h2>Kiểm chứng dự báo có sát thực tế không?</h2>
      <p>Hệ thống chọn các thời điểm trong quá khứ, chỉ dùng số đo <strong>trước thời điểm đó</strong> để dự báo {horizon} phút, rồi so với giá trị thực tế đo được sau đó.</p>
      <p><strong>MAE đa mốc</strong> là trung bình sai số ở +5, +10... đến +{horizon} phút. Mỗi lần đối chiếu chỉ sử dụng dữ liệu đã có trước thời điểm dự báo. Mô hình cơ sở cần ít nhất {CFG.validationMinimumPairs} lần; mô hình mới được kiểm chứng theo các cặp riêng với mô hình cơ sở.</p>
    </section>
    <section className="panel ft-validation-table">
      <div className="ft-section-bar"><h2>So sánh mô hình cơ sở (MAE đa mốc)</h2><span className="ft-muted">Dự báo +5 đến +{horizon} phút · cùng mốc kiểm thử cho ba mô hình cơ sở</span></div>
      <div className="ft-table-scroll"><table><thead><tr><th>Mô hình</th>{metrics.map((key) => <th key={key}>{meta[key].name}<small>{meta[key].unit}</small></th>)}</tr></thead>
        <tbody>{models.map((name) => <tr key={name} className={name === model.temperature || name === model.humidity ? 'ft-table-selected' : ''}>
          <th>{modelLabel[name]}</th>{metrics.map((key) => {
            const item = all[key].find((row) => row.model === name)!;
            return <td key={key}>{formatMAE(item.mae, item.pairs, meta[key].unit)}</td>;
          })}
        </tr>)}{extraModels.map((name) => <tr key={name} className={name === model.temperature || name === model.humidity ? 'ft-table-selected' : ''}>
          <th>{modelLabel[name]}</th>{metrics.map((key) => {
            const row = advanced[key][name as 'random_forest' | 'holt_winters'];
            return <td key={key}>{formatMAE(row.mae, row.pairs, meta[key].unit, 8)}</td>;
          })}
        </tr>)}</tbody></table></div>
      <p className="ft-muted">Dòng Random Forest/Holt-Winters được đối chiếu từng mô hình với mô hình cơ sở tốt nhất trên đúng các mốc nó dự báo được; số cặp có thể khác. Không dùng bảng này để so sánh MAE giữa hai tập đối chiếu khác nhau.</p>
      {best.length ? <p className="ft-muted">Sai số thấp nhất trong ba mô hình cơ sở (khi đủ dữ liệu): {best.map((item) => `${meta[item.metric].name}: ${modelLabel[item.model]}`).join(' · ')}. Không có thuật toán nào luôn tốt nhất trên mọi dữ liệu.</p> : <p className="ft-muted">Chưa có đủ cặp dự báo–đo thực tế để kết luận mô hình nào chính xác hơn.</p>}
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
      <p className="ft-muted">{meta[metric].name} · {modelLabel[selectedModel]} · {enough >= (selectedModel === 'random_forest' || selectedModel === 'holt_winters' ? 8 : CFG.validationMinimumPairs) ? `${enough} lần đối chiếu hợp lệ` : `Chỉ có ${enough} lần đối chiếu, chưa đủ để kết luận`}.</p>
    </section>
  </div>;
}
