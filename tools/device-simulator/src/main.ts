import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { buildPayload } from './payload.js';
import { syncSimulatorConfig, type SimulatorConfig } from './config.js';

const { values } = parseArgs({ options: { scenario: { type: 'string', default: 'normal' } } });
const scenario = z.enum(['normal', 'danger']).parse(values.scenario);
const input = z
  .object({
    SIM_DEVICE_ID: z.uuid(),
    SIM_DEVICE_KEY: z.string().regex(/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/),
    SIM_API_URL: z.url().default('http://127.0.0.1:4000'),
    SIM_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  })
  .parse(process.env);
const apiUrl = new URL(input.SIM_API_URL);
if (
  apiUrl.protocol !== 'https:' &&
  !(apiUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(apiUrl.hostname))
)
  throw new Error('Chỉ cho phép HTTP loopback hoặc HTTPS.');
const bootId = randomUUID();
// Milliseconds is persistent enough for simulator starts, not a firmware counter implementation.
const bootCounter = String(Date.now());
const started = performance.now();
let running = true;
process.on('SIGINT', () => {
  running = false;
});
process.on('SIGTERM', () => {
  running = false;
});
console.log('SIMULATOR — dữ liệu mô phỏng, không phải số đo phần cứng. Ctrl+C để dừng.');
if (scenario === 'danger') {
  console.log(
    'KỊCH BẢN NGUY HIỂM GIẢ LẬP: mẫu 1–2 bình thường, 3–6 Gas/CO/Flame active + còi mô phỏng, 7–10 phục hồi; lặp lại. Không phải ngưỡng gas đã hiệu chuẩn.',
  );
}
let seq = 0n;
let config: SimulatorConfig = { version: 1, intervalMs: input.SIM_INTERVAL_MS };
while (running) {
  try {
    const next = await syncSimulatorConfig(apiUrl, input.SIM_DEVICE_KEY, config);
    if (next.etag !== config.etag)
      console.log(`Cấu hình mô phỏng v${next.version}: chu kỳ ${next.intervalMs} ms.`);
    config = next;
  } catch {
    console.warn('Chưa đồng bộ được cấu hình; giữ chu kỳ hiện tại và thử lại ở vòng sau.');
  }
  const payload = buildPayload({
    deviceId: input.SIM_DEVICE_ID,
    bootId,
    bootCounter,
    seq: String(++seq),
    uptime: Math.floor(performance.now() - started),
    now: new Date(),
    scenario,
  });
  payload.readings[0]!.config_version = config.version;
  let backoff = 1000;
  while (running) {
    try {
      const response = await fetch(new URL('/api/v1/device/telemetry', apiUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `DeviceKey ${input.SIM_DEVICE_KEY}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const alert = payload.readings[0]!.alert_snapshot;
        console.log(
          `Đã nhận mẫu mô phỏng seq=${seq} · Gas=${alert.gas}, CO=${alert.co}, Flame=${alert.flame}, còi mô phỏng=${alert.buzzer_commanded_on ? 'BẬT' : 'TẮT'}`,
        );
        break;
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 429)
        throw new Error(`Lỗi không retry: HTTP ${response.status}. Kiểm tra ID/key/contract.`);
      console.warn(`Server HTTP ${response.status}; đang chờ gửi lại cùng mẫu.`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Lỗi không retry:')) throw error;
      console.warn('Không liên lạc được API; sẽ gửi lại cùng mẫu.');
    }
    await setTimeout(backoff + Math.random() * 500);
    backoff = Math.min(backoff * 2, 60000);
    // Keep immutable reading identity/content; update only transmission metadata on retry.
    payload.transmission.sent_uptime_ms = String(Math.floor(performance.now() - started));
  }
  if (running) await setTimeout(config.intervalMs);
}
