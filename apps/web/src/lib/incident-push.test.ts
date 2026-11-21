import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8');
const id = '01234567-89ab-4cde-8123-123456789abc';
const details = {
  device_name: 'Demo - Lua',
  location: 'Khu / Phòng A',
  condition: 'flame',
  occurred_at: '2026-11-20T17:00:12Z',
  timezone: 'Asia/Ho_Chi_Minh',
};

function display(payload: object) {
  const show = vi.fn();
  const handlers = new Map();
  vm.runInNewContext(source, {
    self: {
      addEventListener: (name: string, fn: unknown) => handlers.set(name, fn),
      registration: { showNotification: show },
    },
  });
  handlers.get('push')({
    data: {
      json: () => ({ incident_id: id, url: '/app/alerts/' + id, simulator: true, ...payload }),
    },
    waitUntil: () => {},
  });
  return show.mock.calls[0]!;
}

it('shows a short localized flame reminder with the snapshotted room and the same incident link', () => {
  const [title, options] = display({ version: 2, severity: 'critical', round: 1, details });
  expect(title).toContain('🔥 Phát hiện lửa');
  expect(title).toContain('Nhắc lại');
  expect(options.body).toContain('Demo - Lua · Khu / Phòng A');
  expect(options.body).toMatch(/00:00:12/);
  expect(options.body).toContain('MÔ PHỎNG');
  expect(options.body).not.toContain(id);
  expect(options.data.url).toBe('/app/alerts/' + id);
});

it('keeps private notifications generic and identifies gas when details are enabled', () => {
  const [title, options] = display({ severity: 'warning' });
  expect(title).toContain('AirGuard');
  const [privateTitle, privateOptions] = display({condition:'flame', severity:'critical'});
  expect(privateTitle).toBe('🔥 Phát hiện lửa · NGHIÊM TRỌNG');
  expect(privateOptions.body).not.toContain('Demo');
  expect(options.body).not.toContain('Phòng A');
  expect(
    display({ version: 2, severity: 'warning', details: { ...details, condition: 'gas' } })[0],
  ).toContain('Phát hiện khí gas');
});
