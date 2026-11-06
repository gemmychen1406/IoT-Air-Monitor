import { expect, it } from 'vitest';
import { telemetrySchema } from '@iot/contracts';
import { buildPayload } from './payload.js';

it('produces raw-only simulator data with stable identity for retry', () => {
  const options = {
    deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    bootId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    bootCounter: '1',
    seq: '2',
    uptime: 10000,
    now: new Date('2026-10-18T08:00:00Z'),
  };
  const payload = buildPayload(options);
  expect(telemetrySchema.safeParse(payload).success).toBe(true);
  expect(payload.readings[0]).toMatchObject({
    seq: '2',
    boot_id: options.bootId,
    firmware_version: 'simulator-0.1.0',
    alert_snapshot: { gas: 'not_configured', co: 'not_configured', flame: 'normal' },
    sensors: { mq2: { concentration_ppm: null }, mq7: { concentration_ppm: null } },
  });
  expect(buildPayload(options)).toEqual(payload);
});

it('cycles simulated danger and recovery without inventing gas concentrations or calibrated readings', () => {
  for (const [seq, active] of [
    ['1', false],
    ['2', false],
    ['3', true],
    ['6', true],
    ['7', false],
    ['10', false],
    ['13', true],
  ] as const) {
    const options = {
      deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      bootId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      bootCounter: '1',
      seq,
      uptime: Number(seq) * 5000,
      now: new Date('2026-10-18T08:00:00Z'),
      scenario: 'danger' as const,
    };
    const payload = buildPayload(options);
    expect(telemetrySchema.safeParse(payload).success).toBe(true);
    expect(payload.readings[0]).toMatchObject({
      alert_snapshot: {
        gas: active ? 'active' : 'normal',
        co: active ? 'active' : 'normal',
        flame: active ? 'active' : 'normal',
        buzzer_commanded_on: active,
      },
      sensors: {
        flame: { detected: active },
        mq2: { quality: 'uncalibrated', concentration_ppm: null },
        mq7: { quality: 'uncalibrated', concentration_ppm: null, heater_control: 'unverified' },
      },
    });
    expect(buildPayload(options)).toEqual(payload);
  }
});
