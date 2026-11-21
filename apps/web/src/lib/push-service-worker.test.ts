import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function worker(windows: object[] = []) {
  const handlers = new Map<string, (event: unknown) => void>();
  const notifications: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: 'https://airguard.example' },
    addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn),
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        notifications.push({ title, options });
      },
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  runInNewContext(await readFile('apps/web/public/push-sw.js', 'utf8'), { self, URL });
  async function dispatch(name: string, event: Record<string, unknown>) {
    expect(typeof handlers.get(name)).toBe('function');
    let done: Promise<unknown> | undefined;
    handlers.get(name)!({
      ...event,
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    await done;
  }
  return { dispatch, notifications, opened };
}
it('shows a generic simulator alert with stable tag and does not claim a closed incident is ongoing', async () => {
  const w = await worker();
  await w.dispatch('push', {
    data: {
      json: () => ({
        severity: 'critical',
        incident_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        simulator: true,
        ended: true,
        url: '/app/alerts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    },
  });
  expect(w.notifications[0]!.title).toContain('NGHIÊM TRỌNG');
  expect(w.notifications[0]!.options.body).toContain('MÔ PHỎNG');
  expect(w.notifications[0]!.options.body).toContain('Đã phục hồi');
  expect(w.notifications[0]!.options.tag).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
it('uses a visible fallback for malformed push and never opens an external notification URL', async () => {
  const w = await worker();
  await w.dispatch('push', {
    data: {
      json: () => {
        throw new Error('bad payload');
      },
    },
  });
  expect(w.notifications).toHaveLength(1);
  let closed = false;
  await w.dispatch('notificationclick', {
    notification: {
      close: () => {
        closed = true;
      },
      data: { url: 'https://evil.example/steal' },
    },
  });
  expect(closed).toBe(true);
  expect(w.opened).toEqual(['https://airguard.example/app/alerts']);
});

it('renders opted-in details only on the versioned payload and allows the history route', async () => {
  const w = await worker();
  const payload = {
    incident_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    url: '/app/notifications',
    details: { condition: 'gas', device_name: 'Cảm biến mẫu', location: 'Tầng 2', observed_at: '2026-11-18T02:00:00Z' },
  };
  await w.dispatch('push', { data: { json: () => payload } });
  expect(w.notifications[0]!.options.body).not.toContain('Tầng 2');
  await w.dispatch('push', { data: { json: () => ({ ...payload, version: 2 }) } });
  expect(w.notifications[1]!.title).toContain('Phát hiện khí gas');
  expect(w.notifications[1]!.options.body).toContain('Cảm biến mẫu · Tầng 2');
  await w.dispatch('notificationclick', {
    notification: { close() {}, data: w.notifications[1]!.options.data },
  });
  expect(w.opened).toEqual(['https://airguard.example/app/alerts/' + payload.incident_id]);
});

it('uses a dedicated private environment payload and opens the environment history', async () => {
  const w = await worker();
  const notice = { version: 3, notification_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'digest', simulator: true };
  await w.dispatch('push', { data: { json: () => notice } });
  await w.dispatch('push', { data: { json: () => ({ ...notice, details: { summary: 'Phòng A · 26 °C' } }) } });
  expect(w.notifications[0]!.options.body).not.toContain('Phòng A');
  expect(w.notifications[1]!.options.body).toContain('Phòng A · 26 °C');
  expect(w.notifications[0]!.options.tag).toContain('airguard-environment-');
  await w.dispatch('notificationclick', { notification: { close() {}, data: w.notifications[0]!.options.data } });
  expect(w.opened).toEqual(['https://airguard.example/app/notifications?view=environment']);
});

it('focuses the navigated window and falls back when a tab disappears for a legacy notification', async () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const url = 'https://airguard.example/app/alerts/' + id;
  const notification = { tag: 'airguard-' + id + '-WARNING', close() {} };
  const calls: string[] = [];
  const gone = { url: 'https://airguard.example/app/spaces', navigate: async () => null };
  const live = { ...gone, navigate: async (to: string) => {
    calls.push(to);
    return { focus: async () => calls.push('focused') };
  }};
  const w = await worker([gone, live]);
  await w.dispatch('notificationclick', { notification });
  expect(calls).toEqual([url, 'focused']);
  expect(w.opened).toEqual([]);
  const fallback = await worker([gone]);
  await fallback.dispatch('notificationclick', { notification });
  expect(fallback.opened).toEqual([url]);
});
