import { it, expect, vi } from 'vitest';
import { createRefetchBatcher } from './refetch-batcher.js';

it('coalesces burst invalidations without starving updates during a continuous stream', () => {
  vi.useFakeTimers();
  try {
    const refreshed: string[] = [];
    const batcher = createRefetchBatcher((key) => refreshed.push(key), 250);
    batcher.request('devices', 'alert-states');
    vi.advanceTimersByTime(100);
    batcher.request('devices');
    vi.advanceTimersByTime(100);
    batcher.request('devices', 'alert-states');
    expect(refreshed).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(refreshed).toEqual(['devices', 'alert-states']);
    batcher.request('devices');
    vi.advanceTimersByTime(250);
    expect(refreshed).toEqual(['devices', 'alert-states', 'devices']);
    batcher.request('credentials');
    batcher.cancel();
    vi.advanceTimersByTime(250);
    expect(refreshed).not.toContain('credentials');
  } finally {
    vi.useRealTimers();
  }
});
