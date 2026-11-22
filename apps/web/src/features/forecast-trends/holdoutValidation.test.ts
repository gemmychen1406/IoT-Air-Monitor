import { describe, expect, it } from 'vitest';
import { evaluateHoldoutForecasts } from './holdoutValidation.js';
import { series } from './testHelpers.js';

describe('chronological holdout evaluation', () => {
  const history = () => series(Array.from({ length: 75 }, (_, i) => 22 + 0.1 * i), Array.from({ length: 75 }, (_, i) => 50 + 0.15 * i));
  it('reports separate +15/+30 errors for temperature/humidity, including Naive on the same targets', () => {
    const rows = evaluateHoldoutForecasts(history());
    expect(rows.map((row) => `${row.metric}:${row.horizon}`)).toEqual([
      'temperature:15', 'temperature:30', 'humidity:15', 'humidity:30',
    ]);
    expect(rows.every((row) => row.pairs === 1 && row.mae !== null && row.naiveMae !== null)).toBe(true);
    expect(rows.find((row) => row.metric === 'temperature' && row.horizon === 15)?.naiveMae).toBeCloseTo(1.5);
    expect(rows.find((row) => row.metric === 'humidity' && row.horizon === 30)?.naiveMae).toBeCloseTo(4.5);
  });
  it('does not use held-out target values to choose or train the model', () => {
    const original = evaluateHoldoutForecasts(history());
    const changed = history();
    // Alter target observations only, without altering the training prefix or cutoff.
    for (let i = 45; i < changed.length; i++) {
      changed[i]!.temperature = 70;
      changed[i]!.humidity = 90;
    }
    const next = evaluateHoldoutForecasts(changed);
    expect(next.map((row) => row.model)).toEqual(original.map((row) => row.model));
    for (let i = 0; i < original.length; i++) {
      const before = original[i]!;
      const after = next[i]!;
      expect(after.prediction).toBeCloseTo(before.prediction!);
      expect(after.actual).toBe(after.metric === 'temperature' ? 70 : 90);
      expect(after.mae).toBeCloseTo(Math.abs(after.prediction! - after.actual!));
    }

  });
  it('never fills missing held-out observations or reports manufactured MAE', () => {
    const points = history();
    points[59]!.temperature = null;
    const rows = evaluateHoldoutForecasts(points);
    const missing = rows.find((row) => row.metric === 'temperature' && row.horizon === 15)!;
    expect(missing.pairs).toBe(0);
    expect(missing.mae).toBeNull();
    expect(missing.reason).toContain('Không có số đo thật');
    expect(rows.find((row) => row.metric === 'humidity' && row.horizon === 15)?.pairs).toBe(1);
    expect(evaluateHoldoutForecasts(series([1, 2, 3])).every((row) => row.mae === null)).toBe(true);
  });
  it('does not select a nearby substitute when a target timestamp is missing', () => {
    const points = history().filter((p) => p.timestamp !== history()[59]!.timestamp);
    expect(evaluateHoldoutForecasts(points).find((row) => row.metric === 'temperature' && row.horizon === 15)?.pairs).toBe(0);
  });
});
