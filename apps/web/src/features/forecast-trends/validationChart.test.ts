import { describe, expect, it } from 'vitest';
import { combineValidationAndFuture } from './validationChart.js';
import { series, START, mins } from './testHelpers.js';
import type { MeasureForecast } from './types.js';

const eligible: MeasureForecast = {
  status: 'eligible', reason: null, lastSampleAt: START + mins(3) + 20_000, current: 27,
  points: [{ timestamp: START + mins(8) + 20_000, value: 28 }, { timestamp: START + mins(18) + 20_000, value: 29 }],
};

describe('validation chart: historical assessment and new forecast are distinct', () => {
  it('adds only real future PREDICTIONS, never future actual readings', () => {
    const chart = combineValidationAndFuture(series([24,25,26,27]), [
      { timestamp: START + mins(2), actual: 26, prediction: 25.5 },
    ], 'temperature', eligible);
    expect(chart.origin).toBe(eligible.lastSampleAt);
    expect(chart.data.find((row) => row.timestamp === START + mins(2))?.prediction).toBe(25.5);
    expect(chart.data.find((row) => row.timestamp === eligible.lastSampleAt)?.future).toBe(27);
    const future = chart.data.filter((row) => row.timestamp > eligible.lastSampleAt!);
    expect(future.map((row) => row.future)).toEqual([28,29]);
    expect(future.every((row) => row.actual === null && row.prediction === null)).toBe(true);
  });
  it('does not draw a fabricated historical measurement across a missing bucket', () => {
    const history = [series([24])[0]!, series([26], undefined, START + mins(2))[0]!];
    const chart = combineValidationAndFuture(history, [], 'temperature', eligible);
    expect(chart.data.find((row) => row.timestamp === START + mins(1))?.actual).toBeNull();
  });
  it('does not include future forecast when the sensor is stale or model is insufficient', () => {
    for (const status of ['stale','insufficient'] as const) {
      const chart = combineValidationAndFuture(series([24,25,26,27]), [], 'temperature',
        { ...eligible, status, points: [] });
      expect(chart.origin).toBeNull();
      expect(chart.data.every((row) => row.future === null)).toBe(true);
    }
  });
});
