import type { DeviceView } from '@iot/contracts';
import { CalendarRange, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { get24hComplianceTimeline } from './utils.js';

export default function HourlyTimelineView({ device }: { device?: DeviceView }) {
  const timeline = get24hComplianceTimeline(device);

  const idealCount = timeline.filter((t) => t.status === 'ideal').length;
  const warningCount = timeline.filter((t) => t.status === 'warning').length;
  const dangerCount = timeline.filter((t) => t.status === 'danger').length;
  const compliancePct = Math.round((idealCount / timeline.length) * 100);

  return (
    <div className="panel hourly-timeline-card">
      <div className="timeline-header">
        <div className="t-header-title">
          <CalendarRange size={18} color="var(--accent)" />
          <h4>Tiến độ Đạt chuẩn & Xu hướng Môi trường 24 Giờ</h4>
        </div>
        <div className="t-stat-pill">
          <span>Tỷ lệ đạt chuẩn 24h:</span>
          <strong>{compliancePct}%</strong>
        </div>
      </div>

      <p className="muted t-desc">
        Chia dữ liệu thành các khoảng thời gian cố định trong ngày, đánh giá mức độ đạt tiêu chuẩn vi khí hậu tại {device?.name ?? 'trạm đo'}.
      </p>

      {/* Dãy 12 khối khung giờ */}
      <div className="timeline-blocks-grid">
        {timeline.map((item, idx) => {
          const isWarning = item.status === 'warning';
          const isDanger = item.status === 'danger';
          const bgClass = isDanger ? 'block-danger' : isWarning ? 'block-warning' : 'block-ideal';

          return (
            <div key={idx} className={`time-block ${bgClass}`}>
              <span className="block-hour">{item.hour}</span>
              <div className="block-indicator">
                {isDanger ? '🔥' : isWarning ? '⚠️' : '✓'}
              </div>
              <span className="block-score">{item.avgScore}đ</span>
              <small className="block-label">{item.label}</small>
            </div>
          );
        })}
      </div>

      <div className="timeline-legend">
        <span><span className="legend-dot dot-ideal" /> Đạt chuẩn mục tiêu (&gt;85đ)</span>
        <span><span className="legend-dot dot-warning" /> Chớm vượt ngưỡng (70-84đ)</span>
        <span><span className="legend-dot dot-danger" /> Vượt ngưỡng nguy cơ (&lt;70đ)</span>
      </div>
    </div>
  );
}
