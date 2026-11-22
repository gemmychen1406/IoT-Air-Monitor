import { describe, expect, it } from 'vitest';
import { evaluateDhtAssessment, evaluateDhtChange } from './dhtAdvisory.js';
import { series, START, mins } from './testHelpers.js';

describe('Four-state Forecast DHT11 assessment', () => {
  it('distinguishes missing and insufficient continuous minutes', () => {
    expect(evaluateDhtAssessment([], START).status).toBe('insufficient');
    expect(evaluateDhtAssessment([], START).validMinutes).toBe(0);
    const five = series([25, 25, 25, 25, 25]);
    expect(evaluateDhtAssessment(five, START + mins(4))).toMatchObject({ status: 'insufficient', validMinutes: 5, requiredMinutes: 6 });
    const gap = series([25, 25, 25, 25, 25, 25]);
    gap[4]!.temperature = null;
    expect(evaluateDhtAssessment(gap, START + mins(5))).toMatchObject({ status: 'insufficient', validMinutes: 1 });
  });
  it('uses exact sensor time for stale state, including the five-minute boundary', () => {
    const points = series([24, 24, 24, 24, 24, 24]);
    const actualSampleAt = START + mins(5) + 35_000;
    expect(evaluateDhtAssessment(points, actualSampleAt + mins(5), actualSampleAt).status).toBe('normal');
    expect(evaluateDhtAssessment(points, actualSampleAt + mins(5) + 1, actualSampleAt).status).toBe('stale');
    expect(evaluateDhtAssessment(points, START + mins(50)).notices).toEqual([]);
  });
  it('declares normal for stable data and small normal simulator fluctuations', () => {
    expect(evaluateDhtAssessment(series(Array(7).fill(25), Array(7).fill(55)), START + mins(6)).status).toBe('normal');
    const normal = series([25,25.1,25.2,25.3,25.4,25.5,25.6], [55,55.2,55.4,55.6,55.8,56.2,56.7]);
    expect(evaluateDhtAssessment(normal, START + mins(6)).status).toBe('normal');
  });
  it('needs both smoothed slope AND full-window amplitude', () => {
    const noAmplitude = series([25,25.15,25.30,25.45,25.60,25.75], [50,50,50,50,50,50]);
    expect(evaluateDhtAssessment(noAmplitude, START + mins(5)).status).toBe('normal');
    const noSlope = series([25,25,25,25,25,26.5], [50,50,50,50,50,50]);
    expect(evaluateDhtAssessment(noSlope, START + mins(5)).status).toBe('normal');
  });
  it('distinguishes increasing and decreasing temperature advice', () => {
    const up = evaluateDhtAssessment(series([20,21,22,23,24,25]), START + mins(5));
    expect(up.status).toBe('watch');
    expect(up.notices[0]!.title).toBe('Nhiệt độ tăng liên tục');
    expect(up.notices[0]!.detail).toContain('nguồn nhiệt');
    const down = evaluateDhtAssessment(series([30,29,28,27,26,25]), START + mins(5));
    expect(down.status).toBe('watch');
    expect(down.notices[0]!.title).toBe('Nhiệt độ giảm liên tục');
    expect(down.notices[0]!.detail).toContain('luồng khí mát');
  });
  it('gives different humidity advice for becoming damp vs dry', () => {
    const up = evaluateDhtAssessment(series([25,25,25,25,25,25], [45,48,51,54,57,60]), START + mins(5));
    expect(up.notices.some(note => note.title === 'Độ ẩm tăng liên tục')).toBe(true);
    expect(up.notices[0]!.detail).toContain('ẩm hơn');
    const down = evaluateDhtAssessment(series([25,25,25,25,25,25], [70,66,62,58,54,50]), START + mins(5));
    expect(down.notices.some(note => note.title === 'Độ ẩm giảm liên tục')).toBe(true);
    expect(down.notices[0]!.detail).toContain('khô dần');
  });
  it('does not flag isolated spikes in 6 or 7 buckets', () => {
    expect(evaluateDhtAssessment(series([25,25,25,30,25,25,25]), START + mins(6))).toMatchObject({ status: 'normal', notices: [] });
    expect(evaluateDhtChange(series([25,25,25,30,25,25,25,25]), START + mins(7))).toEqual([]);
  });
});
