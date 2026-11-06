import { describe, expect, it } from 'vitest';
import { telemetrySchema } from '../src/index.js';
import { samplePayload } from './fixture.js';

describe('telemetry contract v1', () => {
  it('accepts raw readings without claiming a calibrated gas concentration', () => {
    expect(telemetrySchema.safeParse(samplePayload()).success).toBe(true);
  });

  it.each([
    [
      'ADC beyond resolution',
      (p: ReturnType<typeof samplePayload>) => {
        p.readings[0]!.sensors.mq2.adc_raw = 4096;
      },
    ],
    [
      'unverified PPM',
      (p: ReturnType<typeof samplePayload>) => {
        p.readings[0]!.sensors.mq7.concentration_ppm = 50;
      },
    ],
    [
      'invalid sensor with a numeric reading',
      (p: ReturnType<typeof samplePayload>) => {
        p.readings[0]!.sensors.dht11.quality = 'invalid';
      },
    ],
    [
      'humidity outside range',
      (p: ReturnType<typeof samplePayload>) => {
        p.readings[0]!.sensors.dht11.humidity_pct = 101;
      },
    ],
    [
      'identity number above signed bigint',
      (p: ReturnType<typeof samplePayload>) => {
        p.readings[0]!.seq = '9223372036854775808';
      },
    ],
    [
      'unknown schema',
      (p: ReturnType<typeof samplePayload>) => {
        p.schema_version = 2;
      },
    ],
    [
      'valid gas signal missing ADC',
      (p: ReturnType<typeof samplePayload>) => {
        p.readings[0]!.sensors.mq2.quality = 'valid';
        p.readings[0]!.sensors.mq2.adc_raw = null;
      },
    ],
  ])('rejects %s', (_, mutate) => {
    const input = samplePayload();
    mutate(input);
    expect(telemetrySchema.safeParse(input).success).toBe(false);
  });

  it('requires synced timestamps and rejects an unsynced timestamp pretending to be UTC', () => {
    const input = samplePayload();
    input.readings[0]!.time_quality = 'unsynced';
    expect(telemetrySchema.safeParse(input).success).toBe(false);
    input.readings[0]!.sampled_at = null;
    expect(telemetrySchema.safeParse(input).success).toBe(true);
  });
});
