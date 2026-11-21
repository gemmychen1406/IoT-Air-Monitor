import { expect, it } from 'vitest';
import { readingSchema, type RoomMapDevice } from '@iot/contracts';
import { samplePayload } from '../../../../../packages/contracts/tests/fixture.js';
import { mapStatus } from './map-status.js';

const now = Date.parse('2026-11-19T04:03:00Z');
const thresholds = { temperature_c: 30, humidity_pct: 75 };

function device(temperature: number, humidity: number, age = 0): RoomMapDevice {
  const reading = samplePayload().readings[0]!;
  reading.sampled_at = new Date(now - age).toISOString();
  reading.sensors.dht11.temperature_c = temperature;
  reading.sensors.dht11.humidity_pct = humidity;
  return {
    id: 'device',
    name: 'Demo',
    source_kind: 'simulator',
    last_seen_at: new Date(now).toISOString(),
    status: 'online',
    position: null,
    open_incidents: [],
    latest: {
      id: '1',
      received_at: new Date(now).toISOString(),
      payload: readingSchema.parse(reading),
    },
  };
}

it('evaluates devices independently and includes an exact threshold hit', () => {
  expect(mapStatus(device(29, 74), thresholds, now).tone).toBe('normal');
  expect(mapStatus(device(30, 74), thresholds, now).tone).toBe('attention');
  expect(mapStatus(device(26, 75), thresholds, now).tone).toBe('attention');
});

it('uses gray for stale, invalid and offline readings, but open incidents remain red', () => {
  const offline = { ...device(36, 85), status: 'offline' } as const;
  expect(mapStatus(offline, thresholds, now).tone).toBe('unknown');
  expect(mapStatus(device(36, 85, 15_001), thresholds, now).tone).toBe(
    'unknown',
  );
  const invalid = device(36, 85);
  invalid.latest!.payload.sensors.dht11 = {
    temperature_c: null,
    humidity_pct: null,
    quality: 'warming_up',
    age_ms: 0,
  };
  expect(mapStatus(invalid, thresholds, now).tone).toBe('unknown');
  expect(
    mapStatus(
      {
        ...offline,
        open_incidents: [
          { id: 'alert', condition: 'gas', severity: 'warning' },
        ],
      },
      thresholds,
      now,
    ).tone,
  ).toBe('danger');
});
