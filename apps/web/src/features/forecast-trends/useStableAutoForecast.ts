import { useEffect, useState } from 'react';
import { advanceStableAutoState, type StableAutoState } from './stableAutoSelection.js';
import type { ForecastSelection, ModelSelectionResult } from './modelSelection.js';
import type { Measure, MinuteReading } from './types.js';

type Choices = Record<Measure, ModelSelectionResult>;

/** Keep last confirmed auto model while the next MAE snapshot computes.
 * Only a genuinely new measured sample can confirm switching the model.
 * Stale/insufficient data and manual selection bypass the hold immediately.
 */
export function useStableAutoForecast(
  candidate: Choices, history: readonly MinuteReading[],
  deviceId: string, horizon: 15 | 30, preference: ForecastSelection,
  scoreIsCurrent: boolean,
): Choices {
  const [states, setStates] = useState<Record<Measure, StableAutoState | null>>({
    temperature: null, humidity: null,
  });
  const last = history.at(-1);
  // A new minute bucket, not a second sensor packet within the same minute,
  // counts as independent confirmation of a model switch.
  const evidence = last ? String(last.timestamp) : 'empty';
  const scope = `${deviceId}/${horizon}`;

  useEffect(() => {
    if (preference !== 'auto' || !deviceId || !scoreIsCurrent) return;
    const timer = setTimeout(() => setStates((previous) => {
      const updated = {
        temperature: advanceStableAutoState(previous.temperature, candidate.temperature,
          `${scope}/temperature`, evidence),
        humidity: advanceStableAutoState(previous.humidity, candidate.humidity,
          `${scope}/humidity`, evidence),
      };
      return updated.temperature === previous.temperature && updated.humidity === previous.humidity
        ? previous : updated;
    }), 0);
    return () => clearTimeout(timer);
  }, [candidate, deviceId, evidence, preference, scope, scoreIsCurrent]);

  if (preference !== 'auto') return candidate;
  return Object.fromEntries((['temperature', 'humidity'] as const).map((metric) => {
    const result = candidate[metric];
    // Do not mask a sensor that stopped reporting, or a new device/window.
    if (result.basis === 'stale' || result.basis === 'insufficient') return [metric, result];
    const stable = states[metric];
    return [metric, stable?.scope === `${scope}/${metric}` ? stable.selected : result];
  })) as Choices;
}
