import { analyzeTrend } from './timeseries.js';
import { describe, expect, it } from 'vitest';
import { describeDhtTrend, evaluateDhtAssessment, evaluateDhtChange } from './dhtAdvisory.js';
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
    expect(evaluateDhtAssessment(noSlope, START + mins(5)).status).toBe('checking');
  });

  it('detects confirmed rapid heating in 3 minute buckets, before 6-minute window is available', () => {
    const points = series([25, 27, 27], [55, 55, 55]);
    const assessment = evaluateDhtAssessment(points, START + mins(2));
    expect(assessment.status).toBe('watch');
    expect(assessment.notices[0]!.title).toBe('Nhiệt độ tăng nhanh');
    expect(assessment.notices[0]!.detail).toContain('2 phút');
    expect(describeDhtTrend('temperature', analyzeTrend(points, 'temperature', START + mins(2)), assessment)).toContain('tăng nhanh');
  });
  it('can flag a recent rapid change even when the 30-minute slope is nearly flat', () => {
    const points = series([...Array(29).fill(25), 27, 27], Array(31).fill(55));
    const now = START + mins(30);
    expect(analyzeTrend(points, 'temperature', now).status).toBe('stable');
    expect(evaluateDhtAssessment(points, now).status).toBe('watch');
  });
  it('keeps a confirmed sudden heating noticeable during the following plateau', () => {
    const t0 = series([25,27,27,27,27,27], Array(6).fill(55));
    expect(evaluateDhtAssessment(t0, START + mins(5)).status).toBe('watch');
    const later = series([25,27,27,27,27,27,27,27,27], Array(9).fill(55));
    expect(evaluateDhtAssessment(later, START + mins(8)).status).toBe('normal');
  });
  it('recognizes a confirmed rapid decrease in humidity separately from temperature', () => {
    const points = series([25, 25, 25], [65, 59, 59]);
    const assessment = evaluateDhtAssessment(points, START + mins(2));
    expect(assessment.status).toBe('watch');
    expect(assessment.notices[0]!.title).toBe('Độ ẩm giảm nhanh');
  });
  it('does not call one last outlier a confirmed abrupt change', () => {
    const points = series([25, 25, 29], [55, 55, 65]);
    expect(evaluateDhtAssessment(points, START + mins(2))).toMatchObject({ status: 'checking', notices: [], pendingMetrics: ['temperature', 'humidity'] });
    expect(evaluateDhtAssessment([...points, ...series([29], [65], START + mins(3))], START + mins(3)).status).toBe('watch');
  });
  it('keeps a fresh single outlier provisional even with six previous minutes', () => {
    const points = series([25,25,25,25,25,25,29], [55,55,55,55,55,55,55]);
    const latest = evaluateDhtAssessment(points, START + mins(6));
    expect(latest.status).toBe('checking');
    expect(latest.pendingMetrics).toEqual(['temperature']);
    expect(latest.notices).toEqual([]);
    expect(describeDhtTrend('temperature', analyzeTrend(points, 'temperature', START + mins(6)), latest)).toContain('chờ số đo tiếp theo');
  });
  it('does not report short-window fluctuations when direction reverses', () => {
    const points = series([25, 29, 25], [55, 65, 55]);
    expect(evaluateDhtAssessment(points, START + mins(2)).notices).toEqual([]);
  });
  it('rejects gaps between buckets and stale samples even when a change looks large', () => {
    const points = series([25, 27, 27]);
    points[1]!.timestamp += 2 * mins(1);
    expect(evaluateDhtAssessment(points, START + mins(2)).notices).toEqual([]);
    expect(evaluateDhtAssessment(series([25,27,27]), START + mins(9)).status).toBe('stale');
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

describe('short per-metric trend guidance', () => {
  it('describes gentle temperature rise and humidity decline even without alert', () => {
    const points = series(Array.from({ length: 31 }, (_, i) => 24 + i * 0.035),
      Array.from({ length: 31 }, (_, i) => 60 - i * 0.17));
    const now = START + mins(30);
    const assessment = evaluateDhtAssessment(points, now);
    expect(assessment.status).toBe('normal');
    const temp = analyzeTrend(points, 'temperature', now);
    const humidity = analyzeTrend(points, 'humidity', now);
    expect(describeDhtTrend('temperature', temp, assessment)).toContain('xu hướng tăng');
    expect(describeDhtTrend('humidity', humidity, assessment)).toContain('xu hướng giảm');
  });
  it('can acknowledge below-threshold gentle changes without inventing an alert', () => {
    const gentle = series(Array.from({ length: 31 }, (_, i) => 25 + i * 0.01),
      Array.from({ length: 31 }, (_, i) => 50 - i * 0.05));
    const now = START + mins(30);
    const result = evaluateDhtAssessment(gentle, now);
    expect(result.status).toBe('normal');
    expect(describeDhtTrend('temperature', analyzeTrend(gentle, 'temperature', now), result)).toContain('biến thiên nhẹ theo hướng tăng');
    expect(describeDhtTrend('humidity', analyzeTrend(gentle, 'humidity', now), result)).toContain('biến thiên nhẹ theo hướng giảm');
  });
  it('gives clear neutral, warning and stale statements', () => {
    const flat = series(Array(31).fill(25), Array(31).fill(50));
    const now = START + mins(30);
    const normal = evaluateDhtAssessment(flat, now);
    expect(describeDhtTrend('temperature', analyzeTrend(flat, 'temperature', now), normal)).toContain('chưa có xu hướng');
    const sharp = series(Array.from({ length: 7 }, (_, i) => 20 + i), Array(7).fill(55));
    const attention = evaluateDhtAssessment(sharp, START + mins(6));
    expect(describeDhtTrend('temperature', analyzeTrend(sharp, 'temperature', START + mins(6)), attention)).toContain('vượt ngưỡng');
    const stale = evaluateDhtAssessment(flat, now + mins(10));
    expect(describeDhtTrend('humidity', analyzeTrend(flat, 'humidity', now + mins(10)), stale)).toContain('dữ liệu đã cũ');
  });
});
