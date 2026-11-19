// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { App } from './App.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('logs in to the real-data empty dashboard without fabricating telemetry', async () => {
  vi.stubGlobal('fetch', async (url: string) =>
    url.includes('/auth/session')
      ? new Response(JSON.stringify({ error: { message: 'Chưa đăng nhập' } }), { status: 401 })
      : new Response(
          JSON.stringify({
            data: url.includes('/auth/login')
              ? {
                  expires_at: new Date(Date.now() + 3600000).toISOString(),
                  user: { id: 'user-1', email: 'admin@test.local', role: 'admin' },
                }
              : [],
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
  );
  mount();
  fireEvent.change(await screen.findByLabelText('Email'), {
    target: { value: 'admin@test.local' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'correct-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByText('Chưa có thiết bị')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Tổng quan hệ thống' })).toBeInTheDocument();
  expect(screen.queryByText(/27 °C/)).not.toBeInTheDocument();
});
it('shows authentication errors and remains on the login form', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          error: { code: 'INVALID_LOGIN', message: 'Email hoặc mật khẩu không đúng.' },
        }),
        { status: 401 },
      ),
  );
  mount();
  fireEvent.change(await screen.findByLabelText('Email'), {
    target: { value: 'admin@test.local' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email hoặc mật khẩu không đúng.');
  expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
});

it('restores an existing server session on a fresh page mount without exposing a token', async () => {
  vi.stubGlobal(
    'fetch',
    async (url: string) =>
      new Response(
        JSON.stringify({
          data: url.includes('/auth/session')
            ? {
                user: { id: 'user-1', email: 'admin@test.local', role: 'admin' },
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              }
            : [],
        }),
        { status: 200 },
      ),
  );
  mount();
  expect(await screen.findByRole('heading', { name: 'Tổng quan hệ thống' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Mật khẩu')).not.toBeInTheDocument();
});

it('shows a recoverable session-check error instead of pretending a network failure means logout', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('API không phản hồi');
  });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('API không phản hồi');
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Đăng nhập' })).not.toBeInTheDocument();
});
