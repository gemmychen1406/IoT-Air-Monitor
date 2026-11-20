import { describe, expect, it } from 'vitest';
import { gasLevel, type GasLevelInput } from '../src/index.js';

const base: GasLevelInput = { kind: 'mq2', adc_raw: 0, adc_bits: 12, quality: 'valid' };
const at = (ratio: number, extra: Partial<GasLevelInput> = {}) =>
  gasLevel({ ...base, adc_raw: Math.round(ratio * 4095), ...extra });

describe('gasLevel', () => {
  it('maps ADC ratio to four levels', () => {
    expect(at(0.1).id).toBe('normal');
    expect(at(0.4).id).toBe('notice');
    expect(at(0.6).id).toBe('warning');
    expect(at(0.9).id).toBe('danger');
    expect(at(0.9).rank).toBe(3);
  });
  it('never reports a level without valid fresh data', () => {
    expect(at(0.1, { stale: true }).id).toBe('unknown');
    expect(at(0.1, { quality: 'warming_up' }).id).toBe('unknown');
    expect(gasLevel({ ...base, adc_raw: null, quality: 'invalid' }).id).toBe('unknown');
  });
  it('lets a device alert raise but never lower the level', () => {
    expect(at(0.1, { device_alert: 'active' }).id).toBe('warning');
    expect(at(0.9, { device_alert: 'active' }).id).toBe('danger');
    expect(at(0.1, { stale: true, device_alert: 'active' }).id).toBe('warning');
  });
});
