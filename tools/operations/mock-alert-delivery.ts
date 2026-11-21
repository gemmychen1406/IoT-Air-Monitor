import { createDatabase } from '@iot/database';
import { createApp } from '../../apps/api/src/app.js';
import { deliverTelegramNotification, telegramNotifier } from '../../apps/api/src/modules/notifications.js';
import { startEnvironmentScheduler } from '../../apps/api/src/modules/environment/scheduler.js';
import { alertQuietUntil } from '../../apps/api/src/modules/environment/policy.js';
import { environmentSender } from '../../apps/api/src/modules/environment/delivery.js';
import { reconcileOffline } from '../../apps/api/src/modules/presence.js';

const url = URL.parse(process.env.TEST_ALERT_DELIVERY_DATABASE_URL ?? '');
if (
  !url || !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  !/^\/[a-z0-9_]+_demo$/.test(url.pathname)
) throw new Error('Demo yêu cầu PostgreSQL loopback và tên database kết thúc bằng _demo.');

const db = createDatabase(url.toString());
await db.$connect();
const notify = telegramNotifier(true);
const demoEnvironment = process.argv.includes('--environment');
const environment = { telegram: demoEnvironment, telegramSimulators: demoEnvironment };
const app = createApp({
  db, origin: 'http://127.0.0.1:5173', environment,
  notify: async (tx, incident) => {
    const device = await tx.device.findUniqueOrThrow({ where: { id: incident.deviceId }, select: { sourceKind: true } });
    if (device.sourceKind === 'simulator') await notify(tx, incident);
  },
});
const server = app.listen(4000, '127.0.0.1', () => {
  console.log('AirGuard demo :4000 · transport Telegram giả, không gọi mạng ngoài.');
});
const mockSend = async () => ({ ok: true as const });
const ordinary = environmentSender(db, { channel: 'telegram', includeSimulators: true, send: mockSend });
const stopScheduler = demoEnvironment ? startEnvironmentScheduler(db, environment, () =>
  console.error('Demo môi trường gặp lỗi. Kiểm tra migration và kết nối database.'),
) : undefined;
let active: Promise<void> | undefined;
let presenceAt = 0;
const timer = setInterval(() => {
  if (active) return;
  const tick = async () => {
    if (demoEnvironment && Date.now() >= presenceAt) {
      presenceAt = Date.now() + 5000;
      await reconcileOffline(db);
    }
    const alert = await deliverTelegramNotification(db, mockSend, new Date(), true, undefined,
      demoEnvironment ? alertQuietUntil : undefined);
    return alert.processed || !demoEnvironment ? alert : ordinary();
  };
  active = tick().then(
    (result) => {
      if (result.processed) console.log(`Demo transport: ${result.status} (${result.notificationId})`);
    },
    () => console.error('Worker demo gặp lỗi. Kiểm tra migration và kết nối database.'),
  ).finally(() => { active = undefined; });
}, 1000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await stopScheduler?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await active;
  await db.$disconnect();
}
server.on('error', () => {
  console.error('Không mở được API demo tại 127.0.0.1:4000.');
  process.exitCode = 1;
  void stop();
});
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
