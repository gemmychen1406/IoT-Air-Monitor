import { useEffect, useState } from 'react';
import { compareAdvancedCurves, type CurveScore } from './curveValidation.js';
import type { Measure, MinuteReading } from './types.js';
import type { AdvancedForecastModel } from './advancedForecast.js';

export type AdvancedScoreTable = Record<Measure, Record<AdvancedForecastModel, CurveScore>>;
const metrics: readonly Measure[] = ['temperature', 'humidity'];
const models: readonly AdvancedForecastModel[] = ['random_forest', 'holt_winters'];

/** A completed score is displayed while the next history snapshot is processed.
 * A scope includes the device and horizon to prevent cross-device MAE reuse.
 */
export interface AdvancedScoresSnapshot {
  scope: string;
  history: readonly MinuteReading[];
  scores: AdvancedScoreTable;
}

/** Process at most TWO previously unseen origins per timer turn. The per-origin
 * cache in curveValidation.ts survives query refetches and tab switches.
 * Never publish partially processed tables: intermediate counts are not the
 * number of valid comparisons for the whole currently loaded window.
 */
export function useAdvancedCurveScores(
  history: readonly MinuteReading[], horizon: 15 | 30, enabled: boolean, deviceId: string,
): { scores: AdvancedScoreTable | null; current: boolean } {
  const scope = `${deviceId}/${horizon}`;
  const [snapshot, setSnapshot] = useState<AdvancedScoresSnapshot | null>(null);

  useEffect(() => {
    if (!enabled || !deviceId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let cursor = 0;
    const combinations = metrics.flatMap((metric) => models.map((model) => ({ metric, model })));
    const tick = () => {
      if (disposed) return;
      // Rotate work across both sensors and both advanced models. Each new
      // evaluation is a historic origin with completed measured targets.
      for (let i = 0; i < 2; i++) {
        const { metric, model } = combinations[cursor++ % combinations.length]!;
        compareAdvancedCurves(history, metric, horizon, model, undefined, undefined, 1);
      }
      const scores = Object.fromEntries(metrics.map((metric) => [metric,
        Object.fromEntries(models.map((model) => [model,
          compareAdvancedCurves(history, metric, horizon, model, undefined, undefined, 0),
        ])),
      ])) as AdvancedScoreTable;
      if (disposed) return;
      const pending = combinations.some(({ metric, model }) => scores[metric][model].pendingOrigins > 0);
      if (!pending) {
        // Do not clear the previous completed result at the start of a refetch.
        // A genuine rolling-window change is reflected once fully evaluated.
        setSnapshot({ scope, history, scores });
      } else {
        timer = setTimeout(tick, 20); // release control for React/user input
      }
    };
    timer = setTimeout(tick, 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [history, horizon, enabled, deviceId, scope]);

  const matching = enabled && snapshot?.scope === scope ? snapshot : null;
  return { scores: matching?.scores ?? null, current: !!matching && matching.history === history };
}
