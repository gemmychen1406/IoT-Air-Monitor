import { useEffect, useRef, useState } from 'react';
import { evaluateAutoHoldout, HOLDOUT_MODELS, type AutoHoldoutResult } from './autoHoldoutValidation.js';
import { MODEL_LABELS } from './modelSelection.js';
import type { Measure, MinuteReading } from './types.js';

const scenarios: readonly { metric: Measure; horizon: 15 | 30 }[] = [
  { metric: 'temperature', horizon: 15 },
  { metric: 'temperature', horizon: 30 },
  { metric: 'humidity', horizon: 15 },
  { metric: 'humidity', horizon: 30 },
];

const showMetric = (metric: Measure) => metric === 'temperature' ? 'Nhiệt độ' : 'Độ ẩm';
const showUnit = (metric: Measure) => metric === 'temperature' ? '°C' : '%RH';
const format = (value: number | null, metric: Measure) => value === null
  ? '—' : `${value.toLocaleString('vi-VN', { maximumFractionDigits: 3, minimumFractionDigits: 2 })} ${showUnit(metric)}`;

/** Run on explicit user action: advanced historical scoring is CPU-heavy. */
export function AutoHoldoutPanel({ history }: { history: readonly MinuteReading[] }) {
  const [results, setResults] = useState<AutoHoldoutResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const job = useRef(0);
  // Device component is keyed by deviceId; abandon work when unmounted.
  useEffect(() => () => { job.current++; }, []);

  const run = async () => {
    if (isRunning) return;
    const thisJob = ++job.current;
    setIsRunning(true);
    setProgress(0);
    setResults([]);
    const collected: AutoHoldoutResult[] = [];
    try {
      for (const scenario of scenarios) {
        // Give React a chance to paint the current progress before next scenario.
        await new Promise<void>((resolve) => setTimeout(resolve, 15));
        if (job.current !== thisJob) return;
        const result = evaluateAutoHoldout(history, scenario.metric, scenario.horizon);
        if (job.current !== thisJob) return;
        collected.push(result);
        setResults([...collected]);
        setProgress(collected.length);
      }
    } finally {
      if (job.current === thisJob) setIsRunning(false);
    }
  };

  return <section className="panel ft-holdout-panel" aria-label="Kiểm chứng Auto trên dữ liệu tách biệt">
    <div className="ft-section-bar">
      <div><h2>Kiểm chứng Auto trên dữ liệu tách biệt</h2>
        <p className="ft-muted">Tách theo thời gian: 70% đầu để Auto chọn mô hình, 30% cuối để kiểm thử.</p>
      </div>
      <button type="button" disabled={isRunning} onClick={() => void run()}>
        {isRunning ? `Đang kiểm chứng ${progress}/4…` : results.length ? 'Kiểm chứng lại' : 'Chạy kiểm chứng Auto'}
      </button>
    </div>
    <p className="ft-muted">
      Mô hình được Auto chọn tại mốc 70% sẽ được <strong>giữ cố định</strong> khi đánh giá phần dữ liệu còn lại.
      Các lần dự báo trong đoạn kiểm thử chỉ nhìn thấy số đo đã xảy ra ở thời điểm dự báo;
      không sử dụng giá trị tương lai để tính dự báo. Đây là đánh giá lựa chọn ban đầu của Auto,
      không mô phỏng việc Auto tự đổi mô hình liên tục khi chạy thật.
    </p>
    {results.length ? <div className="ft-table-scroll"><table>
      <thead><tr><th>Chỉ số</th><th>Auto đã chọn</th><th>MAE Auto</th><th>MAE Naive</th><th>Mốc hợp lệ</th></tr></thead>
      <tbody>{results.map((result) => <tr key={`${result.metric}-${result.horizon}`}>
        <th>{showMetric(result.metric)} +{result.horizon} phút</th>
        <td>{result.selected ? MODEL_LABELS[result.selected] : '—'}</td>
        <td>{result.status === 'evaluated' ? format(result.autoMae, result.metric) : 'Chưa đủ'}</td>
        <td>{result.status === 'evaluated' ? format(result.naiveMae, result.metric) : 'Chưa đủ'}</td>
        <td>{result.autoPairs}</td>
      </tr>)}</tbody>
    </table></div> : <p className="ft-muted">Chưa chạy kiểm chứng độc lập. Kết quả chỉ được tính khi có đủ số đo thực tế.</p>}
    {results.length ? <div className="ft-holdout-notes">
      {results.map((result) => <p key={`note-${result.metric}-${result.horizon}`} className="ft-muted">
        <strong>{showMetric(result.metric)} +{result.horizon}:</strong> {result.message}
      </p>)}
    </div> : null}
    {results.some((result) => result.status === 'evaluated') ? <details className="ft-holdout-details">
      <summary>Xem MAE +15/+30 phút của cả 5 mô hình trên đoạn kiểm thử</summary>
      <div className="ft-table-scroll"><table><thead><tr><th>Chỉ số</th>{HOLDOUT_MODELS.map((model) => <th key={model}>{MODEL_LABELS[model]}</th>)}</tr></thead>
        <tbody>{results.filter((result) => result.status === 'evaluated').map((result) => <tr key={`compare-${result.metric}-${result.horizon}`}>
          <th>{showMetric(result.metric)} +{result.horizon}</th>
          {result.comparisons.map((score) => <td key={score.model}>
            {format(score.mae, result.metric)} <small>· {score.pairs} lần</small>
          </td>)}
        </tr>)}</tbody>
      </table></div>
      <p className="ft-muted">Các mô hình thiếu dữ liệu huấn luyện có thể có số lần kiểm chứng ít hơn; chỉ so sánh trực tiếp MAE của hai mô hình khi đối chiếu cùng các mốc.</p>
    </details> : null}
  </section>;
}
