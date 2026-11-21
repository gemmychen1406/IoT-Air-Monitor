// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { analyzeAllRoomPairs, analyzeRoomLag, lagCorrelationProfile } from './interRoom.js';
import { series } from './testHelpers.js';

const signal = Array.from({ length: 100 }, (_, index) => 27 + Math.sin(index * 1.43) * 2 + Math.sin(index * 0.33) * 0.7);
const delayed = signal.map((_, index) => index >= 5 ? signal[index - 5]! : 27);

describe('cross-room observational lag', () => {
  it('finds a delayed temperature signal in either direction', () => {
    const result = analyzeRoomLag('a', series(signal), 'b', series(delayed), 'temperature');
    expect(result.status).toBe('candidate');
    expect(result.lagMinutes).toBe(5);
    expect(result.samplePairs).toBeGreaterThan(20);
  });
  it('provides a real-data correlation profile from 0 to 15 minutes', () => {
    const profile = lagCorrelationProfile(series(signal), series(delayed), 'temperature');
    expect(profile).toHaveLength(16);
    expect(profile[0]?.lagMinutes).toBe(0);
    expect(profile[5]?.lagMinutes).toBe(5);
    expect(profile[5]?.samplePairs).toBeGreaterThan(20);
    expect(profile[5]?.correlation).toBeCloseTo(1, 4);
  });
  it('does not invent correlation for a constant signal', () => {
    const profile = lagCorrelationProfile(series(Array(60).fill(25)), series(Array(60).fill(25)), 'temperature');
    expect(profile.every((point) => point.correlation === null)).toBe(true);
  });
  it('does not mistake constant traces for a relationship', () => {
    const result = analyzeRoomLag('a', series(Array(60).fill(27)), 'b', series(Array(60).fill(27)), 'temperature');
    expect(result.status).toBe('not_detected');
  });
  it('ignores tiny periodic simulator noise even when sequences align', () => {
    const source = Array.from({ length: 80 }, (_, i) => 27 + Math.sin(i * 0.5) * 0.2);
    const target = source.map((_, i) => i >= 5 ? source[i - 5]! : 27);
    expect(analyzeRoomLag('a', series(source), 'b', series(target), 'temperature').status).toBe('not_detected');
  });
  it('does not manufacture a correlation when history is too short', () => {
    expect(analyzeRoomLag('a', series([20, 21]), 'b', series([21, 22]), 'temperature').status).toBe('insufficient');
  });
  it('does not connect gradients across missing minutes', () => {
    const target = series(delayed);
    target[30]!.temperature = null;
    const result = analyzeRoomLag('a', series(signal), 'b', target, 'temperature');
    expect(result.samplePairs).toBeLessThan(signal.length);
  });
  it('supports any room as source', () => {
    const results = analyzeAllRoomPairs([{ id: 'a', points: series(signal) }, { id: 'b', points: series(delayed) }]);
    expect(results.some((result) => result.sourceId === 'a' && result.targetId === 'b')).toBe(true);
    expect(results.some((result) => result.sourceId === 'b' && result.targetId === 'a')).toBe(true);
  });
});
