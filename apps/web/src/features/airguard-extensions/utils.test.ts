import { describe, expect, it } from 'vitest';
import type { DeviceView, StatusView } from '@iot/contracts';
import { assessHealth, rangeParams } from './utils.js';

describe('airguard extension utilities', () => {
  it('rejects invalid and overly long ranges', () => {
    expect(() => rangeParams({ from: '2026-01-02T00:00', to: '2026-01-01T00:00', bucket: 'hour' })).toThrow('không hợp lệ');
    expect(() => rangeParams({ from: '2026-01-01T00:00', to: '2026-05-01T00:00', bucket: 'day' })).toThrow('90 ngày');
  });

  it('uses reporting interval and recorded transitions without inventing uptime', () => {
    const device = {
      id: 'device-1', name: 'D1', source_kind: 'physical', status: 'offline',
      last_seen_at: '2026-01-01T00:00:00.000Z', latest: null, reporting_interval_ms: 10000,
    } satisfies DeviceView;
    const history = [
      { id: '1', previous_status: 'online', new_status: 'offline', effective_at: '2026-01-01T00:00:00.000Z', detected_at: '2026-01-01T00:00:00.000Z', reason: 'timeout' },
    ] satisfies StatusView[];
    const result = assessHealth(device, history, Date.parse('2026-01-01T00:01:00.000Z'));
    expect(result.stale).toBe(true);
    expect(result.missing).toBe(true);
    expect(result.offlineTransitions).toBe(1);
    expect(result).not.toHaveProperty('uptime');
  });
});

