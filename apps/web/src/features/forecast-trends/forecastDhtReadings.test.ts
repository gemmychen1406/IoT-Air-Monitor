import { describe, expect, it } from 'vitest';
import { forecastChartPoints } from './forecastDhtReadings.js';
import { reading, START, mins } from './testHelpers.js';

describe('Forecast-only monitoring chart filtering', () => {
  it('plots only valid DHT11 values, keeping invalid positions as gaps', () => {
    const readings = [
      reading(0, 25, 50),
      reading(1, 9999, 9999, { quality: 'invalid' }),
      reading(2, 26, 51),
    ];
    const pts = forecastChartPoints(readings, START + mins(3));
    expect(pts).toHaveLength(3);
    expect(pts.map(p => p.temperature)).toEqual([25, null, 26]);
    expect(pts.map(p => p.humidity)).toEqual([50, null, 51]);
  });
  it('rejects unsynced, future and out-of-range values without graphing garbage', () => {
    const readings = [
      reading(0, 25, 50, { synced: false }),
      reading(1, 200, 50),
      reading(2, 25, -5),
      reading(3, 25, 55),
      reading(9, 100, 50),
    ];
    const pts = forecastChartPoints(readings, START + mins(3));
    expect(pts.map(p => p.temperature)).toEqual([null, null, 25]);
    expect(pts.map(p => p.humidity)).toEqual([null, null, 55]);
  });
});
