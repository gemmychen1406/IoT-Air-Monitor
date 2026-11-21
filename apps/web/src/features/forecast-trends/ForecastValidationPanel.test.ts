// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { validationTrace } from './validation.js';
import { mins, series } from './testHelpers.js';

describe('visible forecast validation trace', () => {
  it('compares only predictions made before the measurement', () => {
    const rows = validationTrace(series(Array.from({length:75}, (_,i)=>20+i*0.25)), 'temperature', 'linear', 15);
    expect(rows.length).toBeGreaterThan(30);
    expect(rows.every(row => Math.abs(row.actual-row.prediction)<1e-6)).toBe(true);
  });
  it('stops when targets are absent instead of filling missing samples', () => {
    const data = series([22,23,24,25,26,27]).map(p=>({...p,timestamp:p.timestamp+mins(100)}));
    expect(validationTrace(data, 'temperature','linear',15)).toEqual([]);
  });
});
