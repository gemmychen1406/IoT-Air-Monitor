// [FORECAST - FILE MOI] Giao dien rieng cua module Phan tich xu huong & Du bao.
import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Measure, MinuteReading } from './types.js';
import { FORECAST_CONFIG as CFG } from './config.js';

export interface DisplayRoom {
  id: string;
  name: string;
  points: readonly MinuteReading[];
}

const timeLabel = (stamp: number) => new Date(stamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const numberLabel = (n: number | null, unit: string) => n === null ? '—' : `${n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}${unit}`;

/** Inspect synchronized readings at a chosen minute, without claiming that correlation proves causation. */
export function RoomImpactTimeline({ rooms, metric, demo, sourceId }: {
  rooms: readonly DisplayRoom[];
  metric: Measure;
  demo: boolean;
  sourceId?: string;
}) {
  const [position, setPosition] = useState(22);
  const commonEnd = Math.min(...rooms.flatMap((room) => room.points.length ? [room.points.at(-1)!.timestamp] : []));
  if (!rooms.length || !Number.isFinite(commonEnd)) return null;
  const targetTime = commonEnd - (30 - position) * CFG.minuteMs;
  const baselineTime = commonEnd - 36 * CFG.minuteMs;
  const unit = metric === 'temperature' ? '°C' : '%RH';
  const changeThreshold = metric === 'temperature' ? 0.8 : 2.5;
  return (
    <section className="panel ft-time-map" aria-label="Diễn biến nhiệt độ và độ ẩm tại các khu vực">
      <div className="ft-section-bar">
        <div><h2>Diễn biến theo từng khu vực</h2><p className="ft-muted">Kéo thanh thời gian để quan sát phòng nào thay đổi trước, phòng nào thay đổi sau.</p></div>
        <span className="ft-time-pill">{timeLabel(targetTime)}</span>
      </div>
      <div className="ft-range-head"><span>{timeLabel(commonEnd - 30 * CFG.minuteMs)}</span><strong>Mốc đang xem: {timeLabel(targetTime)}</strong><span>{timeLabel(commonEnd)}</span></div>
      <input className="ft-time-slider" type="range" min={0} max={30} step={1} value={position} onChange={(event: ChangeEvent<HTMLInputElement>) => setPosition(Number(event.target.value))} aria-label="Chọn mốc thời gian quan sát" />
      <div className="ft-time-rooms">
        {rooms.map((room) => {
          const current = room.points.find((p) => p.timestamp === targetTime)?.[metric] ?? null;
          const base = room.points.find((p) => p.timestamp === baselineTime)?.[metric] ?? null;
          const delta = current !== null && base !== null ? current - base : null;
          const magnitude = delta === null ? 'unknown' : delta >= changeThreshold * 2 ? 'high' : delta >= changeThreshold ? 'medium' : 'normal';
          return <article className={`ft-time-room ft-time-${magnitude}`} key={room.id}>
            <div className="ft-time-room-title"><strong>{room.name}</strong>{demo && room.id === sourceId ? <span>Nguồn mô phỏng</span> : null}</div>
            <div className="ft-time-value">{numberLabel(current, unit)}</div>
            <div className="ft-muted">{delta === null ? 'Chưa có dữ liệu đối chiếu' : `Thay đổi ${delta >= 0 ? '+' : ''}${numberLabel(delta, unit)} so với mốc đầu`}</div>
          </article>;
        })}
      </div>
      <p className="ft-muted">{demo
        ? 'Dữ liệu giả định: mức biến đổi được tạo có độ trễ 5 phút qua mỗi kết nối phòng và giảm biên độ. Đây không phải mô phỏng vật lý đã kiểm chứng.'
        : 'Các con số lấy từ bản ghi lịch sử của thiết bị. Thay đổi liên tiếp không tự chứng minh luồng không khí lan truyền.'}</p>
    </section>
  );
}
