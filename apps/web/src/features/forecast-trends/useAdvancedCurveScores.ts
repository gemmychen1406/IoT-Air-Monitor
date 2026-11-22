import { useEffect, useState } from 'react';
import { compareAdvancedCurves, type CurveScore } from './curveValidation.js';
import type { Measure, MinuteReading } from './types.js';
import type { AdvancedForecastModel } from './advancedForecast.js';

export type AdvancedScoreTable = Record<Measure, Record<AdvancedForecastModel, CurveScore>>;
const metrics: readonly Measure[] = ['temperature', 'humidity'];
const models: readonly AdvancedForecastModel[] = ['random_forest', 'holt_winters'];

/** Run at most TWO new training/checks per timer tick, not during React render.
 * Module-level bounded cache in curveValidation survives UI toggles/remounts.
 * Results are transient and only cover the history currently loaded in memory.
 */
export function useAdvancedCurveScores(history: readonly MinuteReading[], horizon: 15 | 30, enabled: boolean): AdvancedScoreTable | null {
  const [state, setState] = useState<{ history: readonly MinuteReading[]; horizon: number; scores: AdvancedScoreTable } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let cursor = 0;
    let lastPublishedAt = 0;
    const combinations = metrics.flatMap((metric) => models.map((model) => ({ metric, model })));
    const tick = () => {
      if (disposed) return;
      // One new origin per combination for two combinations in each turn.
      for (let i = 0; i < 2; i++) {
        const { metric, model } = combinations[cursor++ % combinations.length]!;
        compareAdvancedCurves(history, metric, horizon, model, undefined, undefined, 1);
      }
      const result = Object.fromEntries(metrics.map((metric) => [metric,
        Object.fromEntries(models.map((model) => [model,
          compareAdvancedCurves(history, metric, horizon, model, undefined, undefined, 0),
        ])),
      ])) as AdvancedScoreTable;
      if (disposed) return;
      const pending = combinations.some(({ metric, model }) => result[metric][model].pendingOrigins > 0);
      // Throttle React updates: base-model walk-forward selection is not cheap.
      const now = Date.now();
      if (!lastPublishedAt || now - lastPublishedAt >= 450 || !pending) {
        setState({ history, horizon, scores: result });
        lastPublishedAt = now;
      }
      if (pending) timer = setTimeout(tick, 20); // yield to user interactions / paint
    };
    timer = setTimeout(tick, 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [history, horizon, enabled]);
  return enabled && state?.history === history && state.horizon === horizon ? state.scores : null;
}
