import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function worker() {
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
      matchAll: async () => [],
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
  expect(w.notifications[0]!.title).toContain('CRITICAL');
  expect(w.notifications[0]!.options.body).toContain('MÔ PHỎNG');
  expect(w.notifications[0]!.options.body).toContain('đã kết thúc');
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
