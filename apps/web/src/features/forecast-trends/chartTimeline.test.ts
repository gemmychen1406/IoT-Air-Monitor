// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { forecastTimeline, trimEmptyStart } from './chartTimeline.js';
import { START, mins, series } from './testHelpers.js';
import type { MeasureForecast, MinuteReading } from './types.js';

function forecast(horizon: 15 | 30): MeasureForecast {
  return {
    status: 'eligible', reason: null, lastSampleAt: START, current: 27,
    points: Array.from({ length: horizon }, (_, index) => ({
      timestamp: START + mins(index + 1), value: 27 + (index + 1) * 0.1,
    })),
  };
}

describe('chart timelines', () => {
  it('removes leading empty minutes without removing gaps after the first measurement', () => {
    const data: MinuteReading[] = series([0, 0, 26, 27, 28]);
    data[0]!.temperature = data[0]!.humidity = null;
    data[1]!.temperature = data[1]!.humidity = null;
    data[3]!.temperature = data[3]!.humidity = null;
    const visible = trimEmptyStart(data);
    expect(visible).toHaveLength(3);
    expect(visible[0]?.timestamp).toBe(START + mins(2));
    expect(visible[1]?.temperature).toBeNull();
  });

  it('starts a 15-minute forecast at the current measurement, never at past history', () => {
    const previous = series([23, 24, 25], undefined, START - mins(3));
    const timeline = forecastTimeline(previous, 'temperature', forecast(15), false)!;
    expect(timeline.data[0]?.timestamp).toBe(START);
    expect(timeline.data.at(-1)?.timestamp).toBe(START + mins(15));
    expect(timeline.ticks).toEqual([0, 5, 10, 15].map((m) => START + mins(m)));
    expect(timeline.data.every((point) => point.timestamp >= START)).toBe(true);
    expect(timeline.data.slice(1).every((point) => point.actual === null)).toBe(true);
  });

  it('shows 5-minute intervals through 30 minutes', () => {
    const timeline = forecastTimeline([], 'humidity', forecast(30), false)!;
    expect(timeline.ticks).toEqual([0, 5, 10, 15, 20, 25, 30].map((m) => START + mins(m)));
  });

  it('in replay mode, compares only future actual readings with the historical prediction', () => {
    const data = series([22, 23, 24, 25, 26], undefined, START + mins(1));
    const timeline = forecastTimeline(data, 'temperature', forecast(15), true)!;
    expect(timeline.data[1]?.actual).toBe(22);
    expect(timeline.data[0]?.actual).toBe(27);
    expect(timeline.data.every((point) => point.timestamp >= START)).toBe(true);
  });

  it('does not create a timeline if prediction is not eligible', () => {
    expect(forecastTimeline([], 'temperature', { ...forecast(15), status: 'stale' }, false)).toBeNull();
  });
});

describe('two future-forecast chart views', () => {
  it('can append the last 30 minutes of REAL observed history and mark gaps', () => {
    const history = series([24, 25, 26, 27], undefined, START - mins(4));
    const sparse = [history[0]!, history[1]!, history[3]!]; // missing minute -2
    const context = forecastTimeline(sparse, 'temperature', forecast(15), false, 'context')!;
    expect(context.data[0]?.timestamp).toBe(START - mins(4));
    expect(context.data.find((point) => point.timestamp === START - mins(2))?.actual).toBeNull();
    expect(context.data.find((point) => point.timestamp === START - mins(3))?.actual).toBe(25);
    expect(context.data.find((point) => point.timestamp === START)?.actual).toBe(27);
    expect(context.data.at(-1)?.timestamp).toBe(START + mins(15));
    expect(context.data.every((point) => point.timestamp <= START || point.actual === null)).toBe(true);
    const future = forecastTimeline(sparse, 'temperature', forecast(15), false, 'future')!;
    expect(future.data.every((point) => point.timestamp >= START)).toBe(true);
  });
  it('keeps replay separate and blocks stale/insufficient prediction for both views', () => {
    for (const view of ['future', 'context'] as const) {
      const failed = { ...forecast(30), status: 'insufficient' as const, points: [] };
      expect(forecastTimeline([], 'temperature', failed, false, view)).toBeNull();
    }
    const replay = forecastTimeline(series([23, 24], undefined, START + mins(1)), 'humidity', forecast(15), true, 'context')!;
    expect(replay.visibleStart).toBe(START);
  });
});
