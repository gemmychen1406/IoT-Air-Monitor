import { expect, it } from 'vitest';
import { plotSeries } from './analytics.js';

it('renders missing buckets as gaps rather than zero or interpolated measurements', () => {
  const output = plotSeries(
    {
      from: '2026-10-18T08:00:00Z',
      to: '2026-10-18T08:03:00Z',
      summary: { total_count: 2, valid_count: 2, invalid_count: 0, min: 20, max: 30, average: 25 },
      series: [
        {
          bucket_start: '2026-10-18T08:00:00Z',
          total_count: 1,
          valid_count: 1,
          invalid_count: 0,
          min: 20,
          max: 20,
          average: 20,
        },
        {
          bucket_start: '2026-10-18T08:02:00Z',
          total_count: 1,
          valid_count: 1,
          invalid_count: 0,
          min: 30,
          max: 30,
          average: 30,
        },
      ],
    },
    'minute',
  );
  expect(output.map((p) => p.average)).toEqual([20, null, 30]);
});
