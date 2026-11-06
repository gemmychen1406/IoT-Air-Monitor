// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import webpush from 'web-push';
import { webcrypto } from 'node:crypto';
import { PushSettings } from './PushSettings.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup(enabled = true) {
  const pair = webpush.generateVAPIDKeys();
  let prompted = 0;
  let browserSubscribed = false;
  let serverSubscribed = false;
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/browser-fixture',
    options: { applicationServerKey: Buffer.from(pair.publicKey, 'base64url') },
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/browser-fixture',
      keys: { p256dh: pair.publicKey, auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
      expirationTime: null,
    }),
    unsubscribe: async () => {
      browserSubscribed = false;
      return true;
    },
  };
  const registration = {
    active: { scriptURL: 'http://localhost:3000/push-sw.js' },
    pushManager: {
      getSubscription: async () => (browserSubscribed ? subscription : null),
      subscribe: async () => {
        browserSubscribed = true;
        return subscription;
      },
    },
    getNotifications: async () => [],
  };
  const notification = {
    permission: 'default',
    requestPermission: async () => {
      prompted++;
      notification.permission = 'granted';
      return 'granted';
    },
  };
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('PushManager', function () {});
  vi.stubGlobal('Notification', notification);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => (browserSubscribed ? registration : undefined),
      register: async () => registration,
      ready: Promise.resolve(registration),
    },
  });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      expect(body.include_simulators).toBe(false);
      expect(body.application_server_key).toBe(pair.publicKey);
      serverSubscribed = true;
    }
    if (init?.method === 'DELETE') {
      serverSubscribed = false;
      return new Response(null, { status: 204 });
    }
    const endpointHash = Buffer.from(
      await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint)),
    ).toString('hex');
    return new Response(
      JSON.stringify({
        data: url.includes('/push/config')
          ? { enabled, public_key: enabled ? pair.publicKey : null, session_bound: true }
          : serverSubscribed
            ? {
                id: 'subscription-1',
                endpoint_hash: endpointHash,
                include_simulators: false,
                vapid_public_key: pair.publicKey,
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              }
            : null,
      }),
    );
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PushSettings />
    </QueryClientProvider>,
  );
  return {
    prompted: () => prompted,
    browserSubscribed: () => browserSubscribed,
    serverSubscribed: () => serverSubscribed,
  };
}
it('asks permission only after an explicit click and supports enabling/disabling the current browser', async () => {
  const state = setup();
  const enable = await screen.findByRole('button', { name: 'Bật Web Push' });
  expect(state.prompted()).toBe(0);
  fireEvent.click(enable);
  await waitFor(() => expect(state.serverSubscribed()).toBe(true));
  expect(
    await screen.findByText('Đang nhận thông báo trên trình duyệt này', { exact: true }),
  ).toBeInTheDocument();
  expect(state.prompted()).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Tắt Web Push' }));
  await waitFor(() => expect(state.serverSubscribed()).toBe(false));
  expect(state.browserSubscribed()).toBe(false);
});
it('explains server-disabled configuration without requesting notification permission', async () => {
  const state = setup(false);
  expect(await screen.findByText(/Backend chưa bật Web Push/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Bật Web Push' })).not.toBeInTheDocument();
  expect(state.prompted()).toBe(0);
});
