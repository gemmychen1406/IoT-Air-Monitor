// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { evaluateDhtChange } from './dhtAdvisory.js';
import { series, START, mins } from './testHelpers.js';

describe('DHT11 temperature/humidity change advisories', () => {
  it('detects sustained humidity increase and decrease', () => {
    const up = series([25,25,25,25,25,25], [45,48,51,54,57,60]);
    expect(evaluateDhtChange(up, START + mins(5)).some((note) => note.title.includes('Độ ẩm tăng'))).toBe(true);
    const down = series([25,25,25,25,25,25], [70,66,62,58,54,50]);
    expect(evaluateDhtChange(down, START + mins(5)).some((note) => note.title.includes('Độ ẩm giảm'))).toBe(true);
  });
  it('detects sustained temperature increase and decrease', () => {
    expect(evaluateDhtChange(series([20,21,22,23,24,25]), START + mins(5)).some((note) => note.title.includes('Nhiệt độ tăng'))).toBe(true);
    expect(evaluateDhtChange(series([30,29,28,27,26,25]), START + mins(5)).some((note) => note.title.includes('Nhiệt độ giảm'))).toBe(true);
  });
  it('does not evaluate stale data', () => {
    expect(evaluateDhtChange(series([20,25,30,35,40,45]), START + mins(50))).toEqual([]);
  });
  it('ignores a one-minute isolated spike', () => {
    const points = series([25,25,25,30,25,25,25,25]);
    expect(evaluateDhtChange(points, START + mins(7))).toEqual([]);
  });
});
