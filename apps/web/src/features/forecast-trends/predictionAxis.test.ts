import { describe, expect, it } from 'vitest';
import { predictionYAxisDomain } from './predictionAxis.js';

describe('prediction chart Y axis', () => {
  it('zooms to small temperature changes without starting at zero', () => {
    expect(predictionYAxisDomain([
      { actual: 28.5, predicted: 28.5 },
      { actual: null, predicted: 29.3 },
    ], 'temperature')).toEqual([27, 30.8]);
  });
  it('keeps a flat prediction readable', () => {
    expect(predictionYAxisDomain([
      { actual: 28.5, predicted: 28.5 },
      { actual: null, predicted: 28.5 },
    ], 'temperature')).toEqual([27, 30]);
  });
  it('clips humidity to its valid 0..100 percent range', () => {
    expect(predictionYAxisDomain([
      { actual: 98, predicted: 98 },
      { actual: null, predicted: 100 },
    ], 'humidity')).toEqual([93, 100]);
    expect(predictionYAxisDomain([{ actual: 0, predicted: 0 }], 'humidity')).toEqual([0, 5]);
  });
  it('ignores null and non-finite chart values', () => {
    expect(predictionYAxisDomain([
      { actual: 25, predicted: NaN },
      { actual: null, predicted: Infinity },
    ], 'temperature')).toEqual([23.5, 26.5]);
  });
  it('handles empty data defensively', () => {
    expect(predictionYAxisDomain([], 'humidity')).toEqual([0, 100]);
  });
});
