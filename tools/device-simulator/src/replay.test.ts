import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { telemetrySchema } from '@iot/contracts';
import { buildPayload } from './payload.js';
import { parseCsv, parseScenario, runReplay } from './replay.js';

const header = 'offset_s,temperature_c,humidity_pct';
const fixture = (name: string) =>
  readFileSync(new URL(`../scenarios/${name}`, import.meta.url), 'utf8');

it('plays the connectivity fixture in order with no sends during the pause', async () => {
  const plan = parseScenario(fixture('connectivity.json'));
  let clock = 0;
  const sentAt: number[] = [];
  await runReplay(plan, {
    clock: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
    running: () => true,
    send: async () => {
      sentAt.push(clock);
    },
  });
  expect(sentAt).toEqual(
    [0, 5, 10, 15, 20, 25, 180, 185, 190, 195, 200, 205, 210, 215, 220].map(
      (s) => s * 1000,
    ),
  );
  expect(clock).toBe(225000);
});

it('keeps the full pause after a send takes longer than its phase', async () => {
  const plan = parseScenario(JSON.stringify({
    version: 1,
    phases: [
      { kind: 'send', duration_s: 2, interval_s: 5, temperature_c: 25, humidity_pct: 50 },
      { kind: 'pause', duration_s: 8 },
      { kind: 'send', duration_s: 2, interval_s: 5, temperature_c: 26, humidity_pct: 50 },
      { kind: 'pause', duration_s: 4 },
    ],
  }));
  let clock = 0;
  const sentAt: number[] = [];
  await runReplay(plan, {
    clock: () => clock,
    wait: async (ms) => { clock += ms; },
    running: () => true,
    send: async () => { sentAt.push(clock); clock += 3000; },
  });
  expect(sentAt).toEqual([0, 11000]);
  expect(clock).toBe(18000);
});

it('covers each minute on both sides of the environment change and emits flame-only snapshots for the incident', () => {
  const environment = parseScenario(fixture('environment.json'));
  expect(environment.durationMs).toBe(780000);
  expect(environment.samples).toHaveLength(156);
  for (let minute = 0; minute < 13; minute++) {
    const samples = environment.samples.filter(
      ({ offsetMs }) => Math.floor(offsetMs / 60000) === minute,
    );
    expect(samples).toHaveLength(12);
    expect(samples.map(({ values }) => values.temperature_c)).toEqual(
      Array(12).fill(minute < 6 ? 26 : 36),
    );
  }
  const incident = parseScenario(fixture('incident.json'));
  for (const [index, { offsetMs, values }] of incident.samples.entries()) {
    const now = new Date(Date.UTC(2026, 10, 20) + offsetMs);
    const payload = buildPayload({
      deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      bootId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      bootCounter: '1',
      seq: String(index + 1),
      uptime: offsetMs,
      now,
      sample: values,
    });
    expect(telemetrySchema.safeParse(payload).success).toBe(true);
    const active = offsetMs >= 15000 && offsetMs < 75000;
    expect(payload.readings[0]).toMatchObject({
      seq: String(index + 1),
      sampled_at: now.toISOString(),
      alert_snapshot: {
        flame: active ? 'active' : 'normal',
        gas: 'not_configured',
        co: 'not_configured',
        buzzer_commanded_on: active,
      },
      sensors: {
        mq2: { concentration_ppm: null },
        mq7: { concentration_ppm: null },
      },
    });
  }
});

it('supports CSV offsets in milliseconds and validates the entire file before playback', () => {
  const csv = parseCsv(`\uFEFF${header}\r\n0.125,-5,52.5\r\n3.250,28,100\r\n`);
  expect(csv.samples).toEqual([
    {
      offsetMs: 125,
      values: { temperature_c: -5, humidity_pct: 52.5, flame: 'normal' },
    },
    {
      offsetMs: 3250,
      values: { temperature_c: 28, humidity_pct: 100, flame: 'normal' },
    },
  ]);
  expect(parseCsv(fixture('example.csv')).samples.length).toBeGreaterThan(1);
  for (const rows of [
    '2,25,50\n1,26,50',
    '2,25,50\n2,26,50',
    '0,NaN,50',
    '0,25,101',
    '0,126,50',
    '-1,25,50',
    '0.0001,25,50',
    '86401,25,50',
    '0,,50',
    '0,25,50,0',
  ])
    expect(() => parseCsv(`${header}\n${rows}`)).toThrow();
  expect(() => parseCsv('time,temp,humidity\n0,25,50')).toThrow();
});

it('rejects invalid JSON phases instead of silently starting normal mode', () => {
  for (const phases of [
    [{ kind: 'pause', duration_s: 1 }],
    [{ kind: 'pause', duration_s: 1, interval_s: 1 }],
    [
      {
        kind: 'send',
        duration_s: 5,
        interval_s: 0,
        temperature_c: 25,
        humidity_pct: 52,
      },
    ],
    [
      {
        kind: 'send',
        duration_s: 5,
        interval_s: 2,
        temperature_c: 25,
        humidity_pct: 52,
        flame: 'fire',
      },
    ],
    [
      {
        kind: 'send',
        duration_s: 86400,
        interval_s: 1,
        temperature_c: 25,
        humidity_pct: 52,
      },
    ],
  ])
    expect(() =>
      parseScenario(JSON.stringify({ version: 1, phases })),
    ).toThrow();
});
