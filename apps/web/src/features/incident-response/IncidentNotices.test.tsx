// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IncidentView } from '@iot/contracts';
import { useIncidentNotices } from './IncidentNotices.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseline = '2026-11-20T00:00:20.000Z';
const old: IncidentView = {
  id: 'old',
  external_id: null,
  device_id: 'device',
  device_name: 'Cảm biến A',
  source_kind: 'simulator',
  condition: 'flame',
  severity: 'critical',
  status: 'active',
  origin: 'snapshot',
  started_at: '2026-11-19T23:59:59.000Z',
  first_observed_at: '2026-11-20T00:00:10.000Z',
  ended_at: null,
  acknowledgement: null,
};
const fresh = {
  ...old,
  id: 'fresh',
  first_observed_at: '2026-11-20T00:00:21.000Z',
};
const freshGas: IncidentView = {
  ...fresh,
  id: 'gas',
  device_id: 'device-gas',
  device_name: 'Cảm biến B',
  condition: 'gas',
  severity: 'warning',
};

function mount() {
  function Harness() {
    const { refresh, banner } = useIncidentNotices('user:session');
    return (
      <>
        <button onClick={() => refresh.current?.()}>Socket event</button>
        {banner}
      </>
    );
  }
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('ignores historic incidents and only shows each newly observed incident once across refreshes', async () => {
  let rows = [old];
  let serverTime = baseline;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/support')
        ? Response.json({
            data: {
              location: {
                source: 'assignment',
                area_name: 'Khu demo',
                room_name: url.includes('/gas/') ? 'Phòng A' : 'Phòng B',
                archived: false,
              },
              contacts: [],
            },
            meta: {},
          })
        : Response.json({
            data: url.includes('limit=1') ? rows.slice(0, 1) : rows,
            meta: { server_time: serverTime },
          }),
    ),
  );
  const view = mount();
  const refresh = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Socket event' }));
  await act(async () => {
    refresh();
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  rows = [fresh, freshGas, { ...freshGas, id: 'gas-again' }, old];
  await act(async () => {
    refresh();
    refresh();
  });
  await screen.findAllByText(/Khu demo \/ Phòng B/);
  await screen.findByText(/Khu demo \/ Phòng A/);
  const links = screen.getAllByRole('link', { name: /Phát hiện/ });
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/app/alerts/fresh',
    '/app/alerts/gas',
    '/app/alerts/gas-again',
  ]);
  expect(links[0]!.closest('[role=status]')).toHaveTextContent(
    /Phát hiện lửa.*Nghiêm trọng.*Cảm biến A.*Phòng B/,
  );
  expect(links[1]!.closest('[role=status]')).toHaveTextContent(
    /khí gas.*Cảnh báo.*Cảm biến B.*Phòng A/,
  );
  for (const close of screen.getAllByRole('button', { name: 'Đóng thông báo' }))
    fireEvent.click(close);
  await act(async () => {
    refresh();
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  view.unmount();
  serverTime = '2026-11-20T00:00:22.000Z';
  await act(async () => {
    mount();
  });
  await act(async () => {
    refresh();
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
