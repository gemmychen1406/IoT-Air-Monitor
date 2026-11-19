// Push-only service worker. No app shell or API response caching.
const incidentPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safePath(value) {
  return typeof value === 'string' &&
    /^\/app\/alerts\/[0-9a-f-]{36}$/i.test(value) &&
    incidentPattern.test(value.slice('/app/alerts/'.length))
    ? value
    : '/app/alerts';
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
  const body = `${payload.simulator === true ? 'MÔ PHỎNG · ' : ''}${payload.ended === true ? 'Có bản ghi sự cố đã kết thúc.' : 'Có cập nhật cảnh báo cần xem.'} Mở AirGuard và đăng nhập để xem chi tiết.`;
  event.waitUntil(
    self.registration.showNotification(`AirGuard — ${severity}`, {
      body,
      tag: id ? `airguard-${id}-${severity}` : 'airguard-alert',
      renotify: false,
      data: { url: safePath(payload.url) },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(safePath(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.navigate(url);
        await client.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
