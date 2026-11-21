// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import type { DeviceView } from '@iot/contracts';
import { latestDhtSnapshot } from './latestDht.js';
import { reading, START } from './testHelpers.js';

function device(latest: DeviceView['latest'], status: DeviceView['status'] = 'online'): DeviceView {
  return {
    id: 'example-id', name: 'Phòng bếp', source_kind: 'simulator',
    last_seen_at: null, status, latest,
  };
}

describe('same live reading as Monitoring', () => {
  it('uses the last reading directly without replacing it by a bucket mean', () => {
    const last = reading(0, 26.4, 61.5, { at: START + 45000 });
    const snapshot = latestDhtSnapshot(device(last), START + 46000);
    expect(snapshot.temperature).toBe(26.4);
    expect(snapshot.humidity).toBe(61.5);
  });
  it('distinguishes invalid measurements and absent readings', () => {
    const invalid = reading(0, null, null, { quality: 'invalid' });
    expect(latestDhtSnapshot(device(invalid), START).temperature).toBeNull();
    expect(latestDhtSnapshot(device(null), START).freshness).toBe('Chưa có dữ liệu');
  });
  it('does not claim an offline device is live', () => {
    expect(latestDhtSnapshot(device(reading(0, 25, 60), 'offline'), START).freshness).toBe('Thiết bị ngoại tuyến');
  });
});
