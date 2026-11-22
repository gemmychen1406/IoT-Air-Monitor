// Avoid changing the automatic model based on incomplete score refreshes or
// one noisy MAE update. Two DISTINCT completed observation snapshots are
// required before switching an already established automatic model.
import type { ModelSelectionResult } from './modelSelection.js';
import type { ForecastModel } from './types.js';

export interface StableAutoState {
  scope: string;
  selected: ModelSelectionResult;
  pendingModel: ForecastModel | null;
  confirmations: number;
  lastEvidence: string;
}

export function advanceStableAutoState(
  previous: StableAutoState | null, candidate: ModelSelectionResult,
  scope: string, evidence: string,
): StableAutoState {
  if (!previous || previous.scope !== scope) {
    return { scope, selected: candidate, pendingModel: null, confirmations: 0, lastEvidence: evidence };
  }
  // A rerender, timer tick or query refetch with IDENTICAL measurements is
  // not a second independent confirmation of a model change.
  if (previous.lastEvidence === evidence) return previous;
  if (previous.selected.model === candidate.model) {
    return { scope, selected: candidate, pendingModel: null, confirmations: 0, lastEvidence: evidence };
  }
  const confirmations = previous.pendingModel === candidate.model ? previous.confirmations + 1 : 1;
  if (confirmations >= 2) {
    return { scope, selected: candidate, pendingModel: null, confirmations: 0, lastEvidence: evidence };
  }
  return { ...previous, pendingModel: candidate.model, confirmations, lastEvidence: evidence };
}
