import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { SCENARIOS, phaseAt } from './scenarios.js';
import { buildPayload } from './payload.js';
import { syncSimulatorConfig, type SimulatorConfig } from './config.js';
import {
  parseCsv,
  parseScenario,
  runReplay,
  type ReplayValues,
} from './replay.js';

const { values } = parseArgs({
  options: {
    scenario: { type: 'string' },
    'scenario-file': { type: 'string' },
    duration: { type: "string", default: "300" },
    amplitude: { type: "string", default: "1" },
    seed: { type: "string", default: "1" },
    repeat: { type: "string", default: "true" },
    csv: { type: 'string' },
    'validate-only': { type: 'boolean' },
  },
});
if (
  [values.scenario, values['scenario-file'], values.csv].filter(
    (value) => value !== undefined,
  ).length > 1
)
  throw new Error('Chọn một trong --scenario, --scenario-file hoặc --csv.');
const scenario = z
  .enum(SCENARIOS)
  .parse(values.scenario ?? 'normal');
const durationSeconds = z.coerce
  .number()
  .int()
  .min(30)
  .max(86400)
  .parse(values.duration);
const amplitude = z.coerce.number().min(0.1).max(2).parse(values.amplitude);
const seed = z.coerce.number().int().min(0).max(2147483647).parse(values.seed);
const repeat = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .parse(values.repeat);
const source = values['scenario-file'] ?? values.csv;
const replay =
  source === undefined
    ? null
    : (values.csv !== undefined ? parseCsv : parseScenario)(
        await readFile(source, 'utf8'),
      );
if (values['validate-only']) {
  if (!replay)
    throw new Error('--validate-only cần --scenario-file hoặc --csv.');
  console.log(
    `Hợp lệ: ${replay.samples.length} mẫu, ${replay.durationMs / 1000} giây.`,
  );
} else {
  await run();
}

async function run() {
  const input = z
    .object({
      SIM_DEVICE_ID: z.uuid(),
      SIM_DEVICE_KEY: z
        .string()
        .regex(/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/),
      SIM_API_URL: z.url().default('http://127.0.0.1:4000'),
      SIM_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(1000)
        .max(60000)
        .default(5000),
    })
    .parse(process.env);
  const apiUrl = new URL(input.SIM_API_URL);
  if (
    apiUrl.protocol !== 'https:' &&
    !(
      apiUrl.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(apiUrl.hostname)
    )
  )
    throw new Error('Chỉ cho phép HTTP loopback hoặc HTTPS.');
  const bootId = randomUUID();
  // Milliseconds is persistent enough for simulator starts, not a firmware counter implementation.
  const bootCounter = String(Date.now());
  const started = performance.now();
  let running = true;
  const controller = new AbortController();
  const stop = () => {
    running = false;
    controller.abort();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  async function wait(ms: number) {
    if (ms <= 0 || !running) return;
    await setTimeout(ms, undefined, { signal: controller.signal }).catch(
      (error: unknown) => {
        if (!controller.signal.aborted) throw error;
      },
    );
  }
  console.log(
    'SIMULATOR — dữ liệu mô phỏng, không phải số đo phần cứng. Ctrl+C để dừng.',
  );
  if (!replay) console.log(`Kịch bản=${scenario.toUpperCase()} · thời lượng=${durationSeconds}s · biên độ=${amplitude} · seed=${seed} · lặp=${repeat}.`);
  let seq = 0n;
  let config: SimulatorConfig = {
    version: 1,
    intervalMs: input.SIM_INTERVAL_MS,
  };
  async function send(sample?: ReplayValues) {
    try {
      const next = await syncSimulatorConfig(
        apiUrl,
        input.SIM_DEVICE_KEY,
        config,
      );
      if (next.etag !== config.etag)
        console.log(
          `Cấu hình mô phỏng v${next.version}: chu kỳ ${next.intervalMs} ms.`,
        );
      config = next;
    } catch {
      console.warn(
        'Chưa đồng bộ được cấu hình; giữ chu kỳ hiện tại và thử lại ở vòng sau.',
      );
    }
    if (!running) return;
    const durationSamples = Math.max(5, Math.round(durationSeconds * 1000 / config.intervalMs));
    const index = Number(seq);
    if (!replay && !repeat && index >= durationSamples) {
      running = false;
      console.log('Kịch bản đã hoàn tất.');
      return;
    }
    const scenarioSample = repeat ? index % durationSamples : index;
    const payload = buildPayload({
      deviceId: input.SIM_DEVICE_ID,
      bootId,
      bootCounter,
      seq: String(++seq),
      uptime: Math.floor(performance.now() - started),
      now: new Date(),
      scenario, scenarioSample, durationSamples, amplitude, seed,
      sample,
    });
    payload.readings[0]!.config_version = config.version;
    let backoff = 1000;
    while (running) {
      try {
        const response = await fetch(
          new URL('/api/v1/device/telemetry', apiUrl),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `DeviceKey ${input.SIM_DEVICE_KEY}`,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10000),
            ]),
          },
        );
        if (response.ok) {
          if (!replay) {
            const reading = payload.readings[0]!;
            console.log(`[${scenario.toUpperCase()}] ${phaseAt(scenarioSample, durationSamples).phase} | Seq ${seq} | Temp ${reading.sensors.dht11.temperature_c}°C | Humidity ${reading.sensors.dht11.humidity_pct}% | MQ2 ${reading.sensors.mq2.adc_raw} ADC | MQ7 ${reading.sensors.mq7.adc_raw} ADC | Flame ${reading.sensors.flame.detected ? 'ON' : 'OFF'} | Sent OK`);
            break;
          }
          const alert = payload.readings[0]!.alert_snapshot;
          console.log(
            `Đã nhận mẫu mô phỏng seq=${seq} · Gas=${alert.gas}, CO=${alert.co}, Flame=${alert.flame}, còi mô phỏng=${alert.buzzer_commanded_on ? 'BẬT' : 'TẮT'}`,
          );
          break;
        }
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        )
          throw new Error(
            `Lỗi không retry: HTTP ${response.status}. Kiểm tra ID/key/contract.`,
          );
        console.warn(
          `Server HTTP ${response.status}; đang chờ gửi lại cùng mẫu.`,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith('Lỗi không retry:')
        )
          throw error;
        if (running)
          console.warn('Không liên lạc được API; sẽ gửi lại cùng mẫu.');
      }
      await wait(backoff + Math.random() * 500);
      backoff = Math.min(backoff * 2, 60000);
      // Keep immutable reading identity/content; update only transmission metadata on retry.
      payload.transmission.sent_uptime_ms = String(
        Math.floor(performance.now() - started),
      );
    }
  }
  try {
    if (replay) {
      console.log(
        `Phát ${replay.samples.length} mẫu theo lịch ${replay.durationMs / 1000} giây.`,
      );
      await runReplay(replay, {
        clock: () => performance.now(),
        wait,
        running: () => running,
        send,
      });
    } else {
      while (running) {
        await send();
        await wait(config.intervalMs);
      }
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
