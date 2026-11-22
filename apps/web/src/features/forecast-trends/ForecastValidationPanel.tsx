// [FORECAST - FILE MOI] Giao dien rieng cua module Phan tich xu huong & Du bao.
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FORECAST_CONFIG as CFG } from './config.js';
import { MODEL_LABELS } from './modelSelection.js';
import { combineValidationAndFuture } from './validationChart.js';
import type { ForecastResult } from './types.js';
import { walkForward, validationTrace } from './validation.js';
import { commonOriginMaes, type CurveScore } from './curveValidation.js';
import { AutoHoldoutPanel } from './AutoHoldoutPanel.js';
import type { AdvancedScoreTable } from './useAdvancedCurveScores.js';
import type { ForecastModel, Measure, MinuteReading } from './types.js';

const meta = {
  temperature: { name: 'Nhiệt độ', unit: '°C' },
  humidity: { name: 'Độ ẩm', unit: '%RH' },
} as const;
const metrics: readonly Measure[] = ['temperature', 'humidity'];
const models: ForecastModel[] = ['naive', 'linear', 'holt'];
const extraModels: ForecastModel[] = ['random_forest', 'holt_winters'];
const modelLabel: Record<ForecastModel, string> = MODEL_LABELS;
const formatMAE = (mae: number | null, count: number, unit: string, minimum: number = CFG.validationMinimumPairs) =>
  mae === null || count < minimum ? `Chưa đủ (${count}/${minimum})` : `${mae.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${unit} · ${count} lần`;

export function ForecastValidationPanel({ history, horizon, model, advancedScores, forecast, deviceId }: {
  history: readonly MinuteReading[];
  horizon: 15 | 30;
  model: Record<Measure, ForecastModel>;
  advancedScores: AdvancedScoreTable | null;
  forecast: ForecastResult;
  deviceId?: string;
}) {
  const [metric, setMetric] = useState<Measure>('temperature');
  const all = useMemo(() => ({
    temperature: walkForward(history, 'temperature', horizon, undefined, { multiStep: true }),
    humidity: walkForward(history, 'humidity', horizon, undefined, { multiStep: true }),
  }), [history, horizon]);
  const advanced = advancedScores; // cached and progressively completed outside render
  const common = useMemo(() => ({
    temperature: commonOriginMaes(advanced?.temperature.random_forest, advanced?.temperature.holt_winters),
    humidity: commonOriginMaes(advanced?.humidity.random_forest, advanced?.humidity.holt_winters),
  }), [advanced]);
  const selectedModel = model[metric];
  const trace = useMemo(
    () => validationTrace(history, metric, selectedModel, horizon),
    [history, metric, selectedModel, horizon],
  );
  const combined = useMemo(() => combineValidationAndFuture(history, trace, metric, forecast[metric]),
    [history, trace, metric, forecast]);

  return <div className="ft-validation">
    <section className="panel ft-validation-table">
      <div className="ft-section-bar"><h2>MAE</h2></div>
      <div className="ft-table-scroll"><table><thead><tr><th>Mô hình</th>{metrics.map((key) => <th key={key}>{meta[key].name}<small>{meta[key].unit}</small></th>)}</tr></thead>
        <tbody>{models.map((name) => <tr key={name} className={name === model.temperature || name === model.humidity ? 'ft-table-selected' : ''}>
          <th>{modelLabel[name]}</th>{metrics.map((key) => {
            const item = all[key].find((row) => row.model === name)!;
            const matched = common[key]?.pairs && common[key]!.pairs >= 8 ? common[key] : null;
            return <td key={key}>{matched
              ? formatMAE(matched.mae[name], matched.pairs, meta[key].unit, 8)
              : formatMAE(item.mae, item.pairs, meta[key].unit)}</td>;
          })}
        </tr>)}{extraModels.map((name) => <tr key={name} className={name === model.temperature || name === model.humidity ? 'ft-table-selected' : ''}>
          <th>{modelLabel[name]}</th>{metrics.map((key) => {
            const row: CurveScore | undefined = advanced?.[key][name as 'random_forest' | 'holt_winters'];
            const matched = common[key]?.pairs && common[key]!.pairs >= 8 ? common[key] : null;
            return <td key={key}>{matched
              ? formatMAE(matched.mae[name], matched.pairs, meta[key].unit, 8)
              : row ? formatMAE(row.mae, row.pairs, meta[key].unit, 8) : 'Đang chuẩn bị kiểm chứng…'}</td>;
          })}
        </tr>)}</tbody></table></div>
    </section>
    <AutoHoldoutPanel key={deviceId ?? 'device'} history={history}/>
    <section className="panel ft-chart-panel ft-wide-panel">
      <div className="ft-section-bar"><div><h2>Lịch sử & dự báo tiếp theo</h2></div>
        <label>Chỉ số <select value={metric} onChange={(event: ChangeEvent<HTMLSelectElement>) => setMetric(event.target.value as Measure)}>
          {metrics.map((key) => <option key={key} value={key}>{meta[key].name}</option>)}
        </select></label>
      </div>
      {combined.data.length ? <div className="ft-chart ft-chart-large" role="img" aria-label="Số đo lịch sử, dự báo hồi cứu và dự báo tương lai">
        <ResponsiveContainer width="100%" height="100%"><LineChart data={combined.data} margin={{ top: 14, right: 10, bottom: 10, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false}/>
          <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => combined.origin !== null && value > combined.origin ? `+${Math.round((value - combined.origin) / CFG.minuteMs)}p` : new Date(value).toLocaleTimeString('vi-VN', {hour:'2-digit',minute:'2-digit'})} tick={{fontSize:11}} minTickGap={50}/>
          <YAxis domain={[0, metric === 'humidity' ? 100 : 'auto']} tick={{fontSize:11}} width={50}/>
          <Tooltip content={({active, payload}) => {
            if (!active || !payload?.length) return null;
            const current = payload[0]?.payload as (typeof combined.data)[number] | undefined;
            if (!current) return null;
            const actual = current.actual;
            const pastPrediction = current.prediction;
            const future = current.future;
            const showError = actual !== null && pastPrediction !== null &&
              Number.isFinite(actual) && Number.isFinite(pastPrediction);
            return <div className="ft-validation-tooltip">
              <strong>{new Date(current.timestamp).toLocaleString('vi-VN')}</strong>
              {actual !== null ? <p>Số đo thực tế: {actual.toFixed(2)} {meta[metric].unit}</p> : null}
              {pastPrediction !== null ? <p>Dự báo lịch sử: {pastPrediction.toFixed(2)} {meta[metric].unit}</p> : null}
              {future !== null ? <p>Dự báo tương lai: {future.toFixed(2)} {meta[metric].unit}</p> : null}
              {showError ? <p><strong>Sai số tuyệt đối: {Math.abs(actual! - pastPrediction!).toFixed(2)} {meta[metric].unit}</strong></p> : null}
            </div>;
          }}/><Legend/>
          {combined.origin !== null ? <ReferenceLine x={combined.origin} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Hiện tại', fill: '#94a3b8', fontSize: 11, position: 'top' }}/> : null}
          <Line dataKey="actual" name="Số đo thực tế" stroke="#38bdf8" strokeWidth={2.2} dot={false} connectNulls={false} isAnimationActive={false}/>
          <Line dataKey="prediction" name="Dự báo lịch sử" stroke="#a78bfa" strokeDasharray="6 4" strokeWidth={2.2} dot={false} connectNulls={false} isAnimationActive={false}/>
          <Line dataKey="future" name="Dự báo tương lai" stroke="#34d399" strokeDasharray="7 4" strokeWidth={2.4} dot={false} connectNulls={false} isAnimationActive={false}/>
        </LineChart></ResponsiveContainer>
      </div> : <div className="ft-empty">Chưa có đủ dữ liệu để vẽ biểu đồ đối chiếu này.</div>}
      {combined.origin === null ? <p className="ft-muted">Chưa có dự báo tương lai hợp lệ; biểu đồ chỉ hiển thị dữ liệu lịch sử.</p> : null}
    </section>
  </div>;
}
