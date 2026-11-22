import { describe, expect, it } from 'vitest';
import { chronologicalHoldout, evaluateAutoHoldout, normalizedHoldoutHistory } from './autoHoldoutValidation.js';
import type { MinuteReading } from './types.js';

const start = Date.parse('2026-11-22T06:00:00.000Z');
const series = (count: number): MinuteReading[] => Array.from({ length: count }, (_, i) => ({
  timestamp: start + i * 60_000,
  temperature: 25 + 0.02 * i,
  humidity: 55 + 0.01 * i,
  count: 1, temperatureMa: null, humidityMa: null,
}));

describe('Auto independent chronological holdout', () => {
  it('uses a time-ordered 70/30 split without mixing train and test samples', () => {
    const split = chronologicalHoldout(series(160));
    expect(split?.train).toHaveLength(112);
    expect(split?.test).toHaveLength(48);
    expect(split!.train.at(-1)!.timestamp).toBeLessThan(split!.test[0]!.timestamp);
  });

  it('does not invent data for absent minutes and deduplicates timestamps', () => {
    const data = series(160);
    const duplicate = { ...data[1]!, temperature: 31 };
    const normalized = normalizedHoldoutHistory([...data, duplicate]);
    expect(normalized).toHaveLength(160);
    expect(normalized[1]!.temperature).toBe(31);
    const missing = data.filter((_, i) => i !== 120);
    expect(normalizedHoldoutHistory(missing)).toHaveLength(159);
  });

  it('does not choose a different Auto model when only held-out future values change', () => {
    const base = series(160);
    const changed = base.map((row, i) => i >= 112 ? {
      ...row, temperature: 40 + i * 0.1,
    } : row);
    const original = evaluateAutoHoldout(base, 'temperature', 15, 3);
    const altered = evaluateAutoHoldout(changed, 'temperature', 15, 3);
    expect(original.selected).toBe(altered.selected);
    expect(original.trainEndAt).toBe(altered.trainEndAt);
    expect(original.autoPairs).toBe(3);
    expect(original.autoMae).not.toBeNull();
  });

  it('calculates endpoint MAE separately for +15 and +30, with real pair counts', () => {
    const data = series(160);
    const fifteen = evaluateAutoHoldout(data, 'temperature', 15, 3);
    const thirty = evaluateAutoHoldout(data, 'temperature', 30, 3);
    expect(fifteen.horizon).toBe(15);
    expect(thirty.horizon).toBe(30);
    expect(fifteen.autoPairs).toBe(3);
    expect(thirty.autoPairs).toBe(3);
    expect(fifteen.naiveMae).toBeCloseTo(0.30, 5);
    expect(thirty.naiveMae).toBeCloseTo(0.60, 5);
  });

  it('reports missing results rather than inventing a MAE on insufficient history', () => {
    const result = evaluateAutoHoldout(series(50), 'humidity', 30);
    expect(result.status).toBe('insufficient');
    expect(result.autoMae).toBeNull();
    expect(result.autoPairs).toBe(0);
  });
});
