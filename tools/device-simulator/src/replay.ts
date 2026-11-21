import { z } from 'zod';

const daySeconds = 86400;
const maxSamples = 10000;
const values = {
  temperature_c: z.number().min(-40).max(125),
  humidity_pct: z.number().min(0).max(100),
  flame: z.enum(['normal', 'active']).default('normal'),
  gas: z.enum(['normal', 'active']).optional(),
};
const sampleSchema = z.strictObject(values);
const duration = z.number().int().min(1).max(daySeconds);
const phaseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('send'),
    duration_s: duration,
    interval_s: z.number().int().min(1).max(60),
    ...values,
  }),
  z.strictObject({ kind: z.literal('pause'), duration_s: duration }),
]);
const scenarioSchema = z.strictObject({
  version: z.literal(1),
  phases: z.array(phaseSchema).min(1).max(100),
});

export type ReplayValues = z.output<typeof sampleSchema>;
export type Replay = {
  durationMs: number;
  trailingPauseMs?: number;
  samples: { offsetMs: number; values: ReplayValues; pauseBeforeMs?: number }[];
};

export function parseScenario(source: string): Replay {
  const { phases } = scenarioSchema.parse(
    JSON.parse(source.replace(/^\uFEFF/, '')),
  );
  const durationSeconds = phases.reduce(
    (sum, phase) => sum + phase.duration_s,
    0,
  );
  const count = phases.reduce(
    (sum, phase) =>
      sum +
      (phase.kind === 'send'
        ? Math.ceil(phase.duration_s / phase.interval_s)
        : 0),
    0,
  );
  if (durationSeconds > daySeconds || count < 1 || count > maxSamples)
    throw new Error('Kịch bản cần từ 1 đến 10000 mẫu và tối đa 24 giờ.');

  const samples: Replay['samples'] = [];
  let offset = 0;
  let pauseBeforeMs = 0;
  for (const phase of phases) {
    if (phase.kind === 'send') {
      const sample = {
        temperature_c: phase.temperature_c,
        humidity_pct: phase.humidity_pct,
        flame: phase.flame,
        ...(phase.gas ? { gas: phase.gas } : {}),
      };
      for (let time = 0; time < phase.duration_s; time += phase.interval_s) {
        samples.push({
          offsetMs: (offset + time) * 1000,
          values: sample,
          ...(pauseBeforeMs ? { pauseBeforeMs } : {}),
        });
        pauseBeforeMs = 0;
      }
    } else {
      pauseBeforeMs += phase.duration_s * 1000;
    }
    offset += phase.duration_s;
  }
  return { durationMs: durationSeconds * 1000, trailingPauseMs: pauseBeforeMs, samples };
}

export function parseCsv(source: string): Replay {
  const [header, ...rows] = source
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split(/\r?\n/);
  if (
    header !== 'offset_s,temperature_c,humidity_pct' ||
    rows.length < 1 ||
    rows.length > maxSamples
  )
    throw new Error(
      'CSV cần tiêu đề offset_s,temperature_c,humidity_pct và 1–10000 dòng dữ liệu.',
    );
  let previous = -1;
  const samples = rows.map((row, index) => {
    const [offset, temperature, humidity, ...extra] = row
      .split(',')
      .map((field) => field.trim());
    const decimal = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
    if (
      !offset ||
      !/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(offset) ||
      !temperature ||
      !humidity ||
      !decimal.test(temperature) ||
      !decimal.test(humidity) ||
      extra.length
    )
      throw new Error(`CSV dòng ${index + 2}: cần đúng ba số thập phân.`);
    const offsetMs = Math.round(Number(offset) * 1000);
    if (offsetMs > daySeconds * 1000 || offsetMs <= previous)
      throw new Error(
        `CSV dòng ${index + 2}: offset phải tăng nghiêm ngặt và không quá 86400 giây.`,
      );
    const parsed = sampleSchema.safeParse({
      temperature_c: Number(temperature),
      humidity_pct: Number(humidity),
    });
    if (!parsed.success)
      throw new Error(
        `CSV dòng ${index + 2}: nhiệt độ hoặc độ ẩm ngoài giới hạn contract.`,
      );
    previous = offsetMs;
    return { offsetMs, values: parsed.data };
  });
  return { samples, durationMs: previous };
}

export async function runReplay(
  plan: Replay,
  options: {
    clock: () => number;
    wait: (ms: number) => Promise<void>;
    running: () => boolean;
    send: (values: ReplayValues) => Promise<void>;
  },
) {
  let started = options.clock();
  let finished = started;
  let previousOffset = 0;
  const delay = (offset: number, pause = 0) =>
    Math.max(0, Math.max(started + offset - previousOffset, finished + pause) - options.clock());
  for (const sample of plan.samples) {
    await options.wait(delay(sample.offsetMs, sample.pauseBeforeMs));
    if (!options.running()) return;
    started = options.clock();
    previousOffset = sample.offsetMs;
    // An in-flight sample and its retries finish before the next sample gets a sequence number.
    await options.send(sample.values);
    finished = options.clock();
  }
  if (options.running())
    await options.wait(delay(plan.durationMs, plan.trailingPauseMs));
}
