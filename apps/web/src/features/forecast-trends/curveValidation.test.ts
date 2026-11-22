import { describe, expect, it } from 'vitest';
import { compareAdvancedCurves, curveValidationCacheStats, resetCurveValidationCache } from './curveValidation.js';
import { series } from './testHelpers.js';

const cyclic = (length: number) => series(
  Array.from({ length }, (_, i) => 26 + 1.2 * Math.sin(2 * Math.PI * i / 15)),
  Array.from({ length }, (_, i) => 58 + 2 * Math.cos(2 * Math.PI * i / 15)),
);

describe('incremental advanced multi-step validation', () => {
  it('can grow beyond 20 distinct measured origins with no hard cap', () => {
    resetCurveValidationCache();
    const result = compareAdvancedCurves(cyclic(190), 'temperature', 15, 'holt_winters');
    expect(result.pendingOrigins).toBe(0);
    expect(result.pairs).toBeGreaterThan(20);
    expect(result.eligibleOrigins).toBeGreaterThanOrEqual(result.pairs);
    expect(result.comparisonMae).toBeGreaterThanOrEqual(0);
  });

  it('also grows Random Forest comparisons beyond 20 when enough training exists', () => {
    resetCurveValidationCache();
    const result = compareAdvancedCurves(cyclic(170), 'temperature', 15, 'random_forest');
    expect(result.pairs).toBeGreaterThan(20);
    expect(result.pendingOrigins).toBe(0);
    expect(result.comparisonModel).not.toBeNull();
  });

  it('respects batch budgets, reuses scores, and extends only for newly completed origins', () => {
    resetCurveValidationCache();
    const first = compareAdvancedCurves(cyclic(140), 'temperature', 15, 'holt_winters', undefined, undefined, 2);
    expect(first.evaluatedOrigins).toBe(2);
    expect(first.pendingOrigins).toBeGreaterThan(0);
    const second = compareAdvancedCurves(cyclic(140), 'temperature', 15, 'holt_winters', undefined, undefined, 2);
    expect(second.evaluatedOrigins).toBe(4);
    const done = compareAdvancedCurves(cyclic(140), 'temperature', 15, 'holt_winters');
    expect(done.pendingOrigins).toBe(0);
    const count = curveValidationCacheStats().computations;
    const repeated = compareAdvancedCurves(cyclic(140), 'temperature', 15, 'holt_winters');
    expect(repeated).toEqual(done);
    expect(curveValidationCacheStats().computations).toBe(count);
    compareAdvancedCurves(cyclic(141), 'temperature', 15, 'holt_winters');
    // Appending a measured minute adds one new completed origin, not 140 retrainings.
    expect(curveValidationCacheStats().computations).toBe(count + 1);
  });

  it('never uses missing actual targets and does not invent comparisons', () => {
    resetCurveValidationCache();
    const observed = cyclic(170);
    const full = compareAdvancedCurves(observed, 'humidity', 15, 'holt_winters');
    const missing = observed.filter((point) => point.timestamp !== observed[155]!.timestamp);
    const withGap = compareAdvancedCurves(missing, 'humidity', 15, 'holt_winters');
    expect(withGap.eligibleOrigins).toBeLessThan(full.eligibleOrigins);
    expect(withGap.pairs).toBeLessThan(full.pairs + 1);
  });

  it('invalidates cached training on corrected historical values, not on merely toggling UI', () => {
    resetCurveValidationCache();
    const initial = cyclic(130);
    compareAdvancedCurves(initial, 'temperature', 15, 'holt_winters');
    const before = curveValidationCacheStats().computations;
    const corrected = initial.map((point, index) => index === 70 ? { ...point, temperature: point.temperature! + 0.35 } : point);
    compareAdvancedCurves(corrected, 'temperature', 15, 'holt_winters');
    expect(curveValidationCacheStats().computations).toBeGreaterThan(before);
    const after = curveValidationCacheStats().computations;
    compareAdvancedCurves(corrected, 'temperature', 15, 'holt_winters');
    expect(curveValidationCacheStats().computations).toBe(after);
  });

  it('does not include future data in training at a completed origin', () => {
    resetCurveValidationCache();
    const data = cyclic(150);
    const originAt = data[130]!.timestamp;
    const cutoff = data.filter((p) => p.timestamp <= originAt);
    const future = data.filter((p) => p.timestamp > originAt).map((p) => ({ ...p, temperature: 40 }));
    const original = [...cutoff, ...data.filter((p) => p.timestamp > originAt)];
    const changed = [...cutoff, ...future];
    // Only the target's actual temperature differs: previous training inputs stay identical.
    const a = compareAdvancedCurves(original, 'temperature', 15, 'holt_winters');
    const b = compareAdvancedCurves(changed, 'temperature', 15, 'holt_winters');
    expect(a.eligibleOrigins).toBe(b.eligibleOrigins);
    expect(b.pendingOrigins).toBe(0);
    expect(curveValidationCacheStats().computations).toBeGreaterThan(0);
    // A changed target must affect the error instead of reusing stale cached MAE.
    expect(Math.abs(a.mae! - b.mae!)).toBeGreaterThan(0);
  });

  it('does not duplicate origins for duplicated timestamp readings', () => {
    resetCurveValidationCache();
    const data = cyclic(145);
    const original = compareAdvancedCurves(data, 'humidity', 15, 'holt_winters');
    const duplicates = [data[45]!, ...data, data[80]!];
    const second = compareAdvancedCurves(duplicates, 'humidity', 15, 'holt_winters');
    expect(second.eligibleOrigins).toBe(original.eligibleOrigins);
    expect(second.pairs).toBe(original.pairs);
  });
});
