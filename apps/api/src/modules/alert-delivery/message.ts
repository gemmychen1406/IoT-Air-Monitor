import type { AlertIncident, Device } from '@prisma/client';

type Snapshot = {
  deviceName: string | null;
  location: string | null;
  locationSource: string | null;
};
type Event = Pick<
  AlertIncident,
  'id' | 'condition' | 'startedAt' | 'firstObservedAt' | 'status' | 'severity'
>;
type Target = Pick<Device, 'id' | 'name' | 'location' | 'sourceKind'>;

export type PushAlertDetails = {
  condition: string;
  device_name: string;
  location: string | null;
  occurred_at: string | null;
  observed_at: string;
  timezone?: string;
};

export function pushDetails(
  incident: Event,
  deviceName: string,
  snapshot: Snapshot | null,
): PushAlertDetails {
  return {
    condition: incident.condition,
    device_name: snapshot?.deviceName ?? deviceName,
    location: snapshot?.location ?? null,
    occurred_at: incident.startedAt?.toISOString() ?? null,
    observed_at: incident.firstObservedAt.toISOString(),
  };
}

export function incidentWebLink(origin: string | undefined, incidentId: string) {
  if (!origin || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(incidentId)) return null;
  try {
    const base = new URL(origin);
    if (
      origin !== base.origin ||
      !(
        base.protocol === 'https:' ||
        (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
      )
    )
      return null;
    return new URL(`/app/alerts/${incidentId}`, base).href;
  } catch {
    return null;
  }
}

export function telegramMessage(
  severity: string,
  incident: Event,
  device: Target,
  snapshot: Snapshot | null,
  webOrigin?: string,
  timezone = 'Asia/Ho_Chi_Minh',
  round = 0,
) {
  const details = pushDetails(incident, device.name, snapshot);
  const title =
    { gas: '⚠️ Phát hiện khí gas', co: '⚠️ Cảnh báo CO', flame: '🔥 Phát hiện lửa' }[
      incident.condition
    ] ?? 'Cảnh báo AirGuard';
  const at = incident.startedAt ?? incident.firstObservedAt;
  const time = at.toLocaleTimeString('vi-VN', { timeZone: timezone, hour12: false });
  const date = at.toLocaleDateString('vi-VN', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const link = incidentWebLink(webOrigin, incident.id);
  return [
    title,
    severity === 'critical' ? '🔴 Mức độ: NGHIÊM TRỌNG' : '🟠 Mức độ: CẢNH BÁO',
    ...(round ? [`Nhắc lại · lần ${round}`] : []),
    '📍 ' + [details.device_name, details.location].filter(Boolean).join(' · '),
    '🕒 ' + [time, date, device.sourceKind === 'simulator' ? 'MÔ PHỎNG' : null].filter(Boolean).join(' · '),
    'Trạng thái lúc gửi: ' + (incident.status === 'ended' ? 'Đã phục hồi' : 'Sự cố đang mở'),
    ...(link ? [link] : []),
  ].join('\n');
}
