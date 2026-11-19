import { expect, it } from 'vitest';
import { telemetrySchema } from '@iot/contracts';
import { samplePayload } from '../../../../packages/contracts/tests/fixture.js';
import { sensorFreshness } from './freshness.js';

it('does not treat freshly uploaded old samples as newly measured', () => {
  const reading = {
    id: '1',
    received_at: '2026-10-18T10:00:00Z',
    payload: telemetrySchema.parse(samplePayload()).readings[0]!,
  };
  expect(sensorFreshness(reading, 0, Date.parse('2026-10-18T10:00:00Z'))).toBe('Dữ liệu cũ');
});
it('keeps unknown sample times unknown', () => {
  const input = samplePayload();
  input.readings[0]!.time_quality = 'unsynced';
  input.readings[0]!.sampled_at = null;
  const reading = {
    id: '1',
    received_at: '2026-10-18T08:00:00Z',
    payload: telemetrySchema.parse(input).readings[0]!,
  };
  expect(sensorFreshness(reading, 0, Date.parse(reading.received_at))).toBe('Chưa rõ thời điểm đo');
});
