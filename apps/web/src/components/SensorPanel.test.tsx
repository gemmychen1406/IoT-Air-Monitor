// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { telemetrySchema, type DeviceView } from '@iot/contracts';
import { samplePayload } from '../../../../packages/contracts/tests/fixture.js';
import { SensorPanel } from './SensorPanel.js';

afterEach(cleanup);
const now = Date.parse('2026-10-18T08:00:10Z');
const device = (): DeviceView => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Thiết bị thử',
  source_kind: 'simulator',
  last_seen_at: '2026-10-18T08:00:00Z',
  status: 'online',
  latest: {
    id: '1',
    received_at: '2026-10-18T08:00:00Z',
    payload: telemetrySchema.parse(samplePayload()).readings[0]!,
  },
});
it('labels simulated raw gas readings without claiming PPM or safety', () => {
  render(<SensorPanel device={device()} now={now} />);
  expect(screen.getByText(/Dữ liệu mô phỏng/)).toBeInTheDocument();
  expect(screen.getByText('1250')).toBeInTheDocument();
  expect(screen.getAllByText('Chưa cấu hình đánh giá')).toHaveLength(2);
  expect(screen.queryByText(/an toàn/i)).not.toBeInTheDocument();
});
it('shows an invalid sensor as missing rather than zero', () => {
  const d = device();
  d.latest!.payload.sensors.dht11 = {
    temperature_c: null,
    humidity_pct: null,
    quality: 'invalid',
    age_ms: 0,
  };
  render(<SensorPanel device={d} now={now} />);
  expect(screen.getByLabelText('Nhiệt độ')).toHaveTextContent('—');
  expect(screen.getByLabelText('Nhiệt độ')).toHaveTextContent('Lỗi cảm biến');
});
it('distinguishes online from stale sensor data', () => {
  render(<SensorPanel device={device()} now={now + 120000} />);
  expect(screen.getAllByText('Dữ liệu cũ').length).toBeGreaterThan(0);
});
it('does not show normal readings when no telemetry has arrived', () => {
  const d = device();
  d.latest = null;
  render(<SensorPanel device={d} now={now} />);
  expect(screen.getByText('Chưa có dữ liệu cảm biến')).toBeInTheDocument();
  expect(screen.queryByText('Không phát hiện')).not.toBeInTheDocument();
});
