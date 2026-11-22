import { describe, expect, it } from 'vitest';
import { advanceStableAutoState } from './stableAutoSelection.js';
import type { ModelSelectionResult } from './modelSelection.js';

function candidate(model: ModelSelectionResult['model']): ModelSelectionResult {
  return { model, basis: 'recent_mae', metric: 'temperature', horizon: 15,
    pairs: 30, mae: 0.2, metricStatus: 'normal', explanation: model };
}

describe('stable automatic model selection', () => {
  it('does not switch on one refresh and ignores duplicate evidence', () => {
    const initial = advanceStableAutoState(null, candidate('naive'), 'stationA/15/temperature', 't1');
    const first = advanceStableAutoState(initial, candidate('random_forest'), initial.scope, 't2');
    expect(first.selected.model).toBe('naive');
    expect(first.confirmations).toBe(1);
    const sameData = advanceStableAutoState(first, candidate('random_forest'), initial.scope, 't2');
    expect(sameData).toBe(first);
    expect(sameData.selected.model).toBe('naive');
    const confirmed = advanceStableAutoState(sameData, candidate('random_forest'), initial.scope, 't3');
    expect(confirmed.selected.model).toBe('random_forest');
  });
  it('cancels a pending switch if the original model wins again', () => {
    const initial = advanceStableAutoState(null, candidate('naive'), 'stationA/15/temperature', 't1');
    const temporary = advanceStableAutoState(initial, candidate('random_forest'), initial.scope, 't2');
    const recovered = advanceStableAutoState(temporary, candidate('naive'), initial.scope, 't3');
    expect(recovered.selected.model).toBe('naive');
    expect(recovered.pendingModel).toBeNull();
    const temporary2 = advanceStableAutoState(recovered, candidate('random_forest'), initial.scope, 't4');
    expect(temporary2.selected.model).toBe('naive');
  });
  it('does not carry model selections across station, metric or horizon changes', () => {
    const first = advanceStableAutoState(null, candidate('naive'), 'stationA/15/temperature', 't1');
    const other = advanceStableAutoState(first, candidate('random_forest'), 'stationB/15/temperature', 't1');
    expect(other.selected.model).toBe('random_forest');
    expect(other.confirmations).toBe(0);
  });
});
