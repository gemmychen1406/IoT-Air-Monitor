// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IncidentSupportView } from '@iot/contracts';
import IncidentSupport from './IncidentSupport.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows a copyable validated number with a call link and selects it when clipboard is denied', async () => {
  const data: IncidentSupportView = {
    location: {
      source: 'assignment',
      area_name: 'Khu mẫu',
      room_name: 'Phòng mẫu',
      description: 'Tầng 2',
      archived: false,
    },
    contacts: [{
      id: 'contact',
      name: 'Liên hệ mẫu',
      role: 'Trực ca',
      phone: '+12025550101',
      description: '',
      priority: 1,
      scope: { kind: 'global' },
      archived_at: null,
    }],
  };
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data, meta: {} })));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IncidentSupport incidentId="demo" />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('textbox', { name: 'Số điện thoại của Liên hệ mẫu' })).toHaveValue('+12025550101');
  expect(screen.getByRole('link', {name:'Gọi'})).toHaveAttribute('href','tel:+12025550101');
  expect(screen.getByText(/Khu mẫu \/ Phòng mẫu/)).toBeInTheDocument();

  // jsdom has no system clipboard integration.
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép số' }));
  expect(await screen.findByText(/Số đã được chọn/)).toBeInTheDocument();
  const phone = screen.getByRole('textbox', {
    name: 'Số điện thoại của Liên hệ mẫu',
  }) as HTMLInputElement;
  expect(phone).toHaveFocus();
  expect(phone.selectionStart).toBe(0);
  expect(phone.selectionEnd).toBe(phone.value.length);
});

it('hides cached location and copy actions after a failed refetch, and restores them on retry', async () => {
  const data: IncidentSupportView = {
    location: { source: 'device_location', description: 'Vị trí mẫu', area_name: null, room_name: null, archived: false },
    contacts: [{
      id: 'contact', name: 'Trực ca', role: 'Hỗ trợ', phone: '+12025550101', priority: 1,
      description: '', scope: { kind: 'global' }, archived_at: null,
    }],
  };
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data, meta: {} })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Mất kết nối danh bạ' } }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data, meta: {} })));
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><IncidentSupport incidentId="demo" /></QueryClientProvider>);
  expect(await screen.findByRole('button', { name: 'Sao chép số' })).toBeInTheDocument();
  await act(() => client.invalidateQueries({ queryKey: ['incident-support', 'demo'] }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Mất kết nối danh bạ');
  expect(client.getQueryData(['incident-support', 'demo'])).toEqual(data);
  expect(screen.queryByText(/Vị trí mẫu/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sao chép số' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('button', { name: 'Sao chép số' })).toBeInTheDocument();
});
