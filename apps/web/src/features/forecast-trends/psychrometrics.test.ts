// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { absoluteHumidity, dewPoint, relativeHumidityFromAbsolute } from './psychrometrics.js';

describe('derived humidity diagnostics', () => {
  it('converts 20°C at 50%RH to approximately 8.62 g/m³', () => {
    expect(absoluteHumidity(20, 50)).toBeCloseTo(8.62, 1);
  });
  it('keeps absolute humidity unchanged when RH is recomputed after heating', () => {
    const amount = absoluteHumidity(22, 60)!;
    const newRh = relativeHumidityFromAbsolute(30, amount)!;
    expect(newRh).toBeLessThan(60);
    expect(absoluteHumidity(30, newRh)).toBeCloseTo(amount, 5);
  });
  it('has dew point equal to temperature at saturation', () => {
    expect(dewPoint(24, 100)).toBeCloseTo(24, 6);
  });
  it('rejects invalid humidity instead of manufacturing a value', () => {
    expect(absoluteHumidity(22, 101)).toBeNull();
    expect(dewPoint(22, 0)).toBeNull();
    expect(relativeHumidityFromAbsolute(22, -1)).toBeNull();
  });
});
