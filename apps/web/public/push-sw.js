// Push-only service worker. No app shell or API response caching.
const incidentPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safePath(value) {
  if (value === '/app/notifications' || value === '/app/notifications?view=environment') return value;
  return typeof value === 'string' &&
    /^\/app\/alerts\/[0-9a-f-]{36}$/i.test(value) &&
    incidentPattern.test(value.slice('/app/alerts/'.length))
    ? value
    : '/app/alerts';
}
function alertDisplay(payload, id) {
  const detail = payload.version === 2 && id && payload.details;
  const titles = { gas:'⚠️ Phát hiện khí gas', co:'⚠️ Cảnh báo CO', flame:'🔥 Phát hiện lửa' };
  const condition = detail?.condition ?? payload.condition;
  const title = id && Object.hasOwn(titles, condition) ? titles[condition] : 'Cảnh báo AirGuard';
  const parts = [];
  if (detail) {
    for (const value of [detail.device_name,detail.location])
      if (typeof value === 'string' && value.trim()) parts.push(value.trim().slice(0,180));
    const at = Date.parse(detail.occurred_at ?? detail.observed_at);
    if (Number.isFinite(at)) {
      try { parts.push(new Date(at).toLocaleString('vi-VN',{timeZone: detail.timezone || 'Asia/Ho_Chi_Minh'})); }
      catch { /* A legacy timezone may no longer be supported by this browser. */ }
    }
  } else parts.push('Mở AirGuard để xem sự cố');
  if (payload.simulator === true) parts.push('MÔ PHỎNG');
  if (payload.ended === true) parts.push('Đã phục hồi');
  return { title, body:parts.join(' · ') };
}
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    const value = event.data?.json();
    if (value && typeof value === 'object' && !Array.isArray(value)) payload = value;
  } catch {
    /* Visible generic fallback; no secrets or raw payload logging. */
  }
  if (payload.version === 3 && typeof payload.notification_id === 'string' && incidentPattern.test(payload.notification_id)) {
    const parts = [];
    if (payload.simulator === true) parts.push('MÔ PHỎNG');
    const summary = payload.details?.summary;
    parts.push(typeof summary === 'string' && summary.trim() ? summary.trim().slice(0, 600) : 'Có tin môi trường hoặc kết nối mới. Mở AirGuard để xem.');
    event.waitUntil(self.registration.showNotification('AirGuard — Môi trường & kết nối', {
      body: parts.join('\n'), tag: `airguard-environment-${payload.notification_id}`, renotify: false,
      data: { url: '/app/notifications?view=environment' },
    }));
    return;
  }
  const severity =
    payload.severity === 'critical'
      ? 'CRITICAL'
      : payload.severity === 'warning'
        ? 'WARNING'
        : 'Thông báo';
  const id =
    typeof payload.incident_id === 'string' && incidentPattern.test(payload.incident_id)
      ? payload.incident_id
      : null;
  const reminder = severity === 'CRITICAL' && Number.isSafeInteger(payload.round) && payload.round > 0;
  const display = alertDisplay(payload,id);
  event.waitUntil(
    self.registration.showNotification(`${display.title} · ${severity === 'CRITICAL' ? 'NGHIÊM TRỌNG' : severity === 'WARNING' ? 'CẢNH BÁO' : severity}${reminder ? ' · Nhắc lại' : ''}`, {
      body:display.body,
      tag: id ? `airguard-${id}-${severity}` : 'airguard-alert',
      renotify: !!id && reminder,
      data: { incident_id: id, url: id ? '/app/alerts/' + id : safePath(payload.url) },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notification = event.notification;
  const legacyId = /^airguard-([0-9a-f-]{36})-(?:WARNING|CRITICAL)$/i.exec(notification.tag || '')?.[1];
  const id = notification.data?.incident_id ?? legacyId;
  const path = incidentPattern.test(id) ? '/app/alerts/' + id : safePath(notification.data?.url);
  const url = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const current = new URL(client.url);
      if (current.origin !== self.location.origin || !/^\/app(?:\/|$)/.test(current.pathname)) continue;
      try {
        const target = client.url === url ? client : await client.navigate(url);
        if (!target) continue;
        await target.focus();
        return;
      } catch {
        // A tab may have been closed or replaced since matchAll.
      }
    }
    await self.clients.openWindow(url);
  })());
});
