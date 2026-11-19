import { api, HttpError } from './api.js';

export const supportsWebPush = () =>
  typeof window !== 'undefined' &&
  globalThis.isSecureContext &&
  'serviceWorker' in navigator &&
  typeof PushManager !== 'undefined' &&
  typeof Notification !== 'undefined';
function base64(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
function keyBuffer(key: string) {
  return Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
    char.charCodeAt(0),
  ).buffer;
}
async function registration() {
  if (!('serviceWorker' in navigator)) return undefined;
  const row = await navigator.serviceWorker.getRegistration('/push-sw.js');
  if (row?.active?.scriptURL && new URL(row.active.scriptURL).pathname !== '/push-sw.js')
    return undefined;
  return row;
}
export async function browserPushStatus() {
  if (!supportsWebPush()) return null;
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
  return {
    endpointHash: [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join(''),
    publicKey: sub.options.applicationServerKey ? base64(sub.options.applicationServerKey) : null,
  };
}
export async function enableBrowserPush(publicKey: string, includeSimulators: boolean) {
  if (!supportsWebPush())
    throw new Error('Web Push cần HTTPS hoặc localhost và trình duyệt có hỗ trợ.');
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : Notification.permission === 'denied'
        ? 'denied'
        : await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error('Chưa được cấp quyền thông báo. Kiểm tra quyền của trang trong trình duyệt.');
  const row = await navigator.serviceWorker.register('/push-sw.js', {
    scope: '/',
    updateViaCache: 'none',
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Service worker chưa sẵn sàng. Tải lại trang rồi thử lại.')),
      10000,
    );
    navigator.serviceWorker.ready.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        reject(new Error('Không kích hoạt được service worker.'));
      },
    );
  });
  let sub = await row.pushManager.getSubscription();
  if (
    sub &&
    (!sub.options.applicationServerKey || base64(sub.options.applicationServerKey) !== publicKey)
  ) {
    await api('/push/subscription', { method: 'DELETE' });
    await sub.unsubscribe();
    sub = null;
  }
  const created = !sub;
  sub ??= await row.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBuffer(publicKey),
  });
  try {
    await api('/push/subscription', {
      method: 'POST',
      body: JSON.stringify({
        subscription: sub.toJSON(),
        application_server_key: publicKey,
        include_simulators: includeSimulators,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (created) await sub.unsubscribe().catch(() => false);
    throw error;
  }
}
export async function clearBrowserPush() {
  const row = await registration();
  if (!row) return;
  const sub = await row.pushManager.getSubscription();
  await Promise.all([
    sub?.unsubscribe(),
    row
      .getNotifications()
      .then((notifications) => notifications.forEach((n) => n.close()))
      .catch(() => {}),
  ]);
}
export async function disableBrowserPush() {
  let failure: unknown;
  try {
    await api('/push/subscription', { method: 'DELETE', signal: AbortSignal.timeout(10000) });
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 401)) failure = error;
  }
  try {
    await clearBrowserPush();
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}
