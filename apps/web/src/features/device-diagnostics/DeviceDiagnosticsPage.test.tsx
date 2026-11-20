// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { DeviceView, DiagnosticReport } from "@iot/contracts";
import DeviceDiagnosticsPage from "./DeviceDiagnosticsPage.js";
const device: DeviceView = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Cảm biến nhà bếp",
  source_kind: "physical",
  location: "Bếp",
  status: "never_seen",
  last_seen_at: null,
  latest: null,
};
const report: DiagnosticReport = {
  from: "2026-11-20T10:00:00Z",
  to: "2026-11-20T11:00:00Z",
  generated_at: "2026-11-20T11:00:01Z",
  source_kind: "physical",
  count: 0,
  completeness: {
    truncated: false,
    rolled_up: false,
    status_truncated: false,
    config_truncated: false,
    first_received_at: null,
    last_received_at: null,
  },
  quality: [],
  events: [],
  event_count: 0,
  connection: {
    offline_ms: 0,
    unknown_ms: 3600000,
    disconnects: 0,
    interval_median_ms: null,
    delay_median_ms: null,
    delay_p95_ms: null,
    delay_count: 0,
  },
  clock: { synced: 0, unsynced: 0, backwards: 0, future: 0 },
  sessions: [],
  firmware_changes: [],
  session_count: 0,
  firmware_change_count: 0,
  reboots_observed: 0,
  notices: [],
};
function mount(devices = [device], userId = "ha") {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <DeviceDiagnosticsPage devices={devices} userId={userId} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("guides a household with no devices without fetching or inventing telemetry", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mount([]);
  expect(screen.getByText("Chưa có thiết bị để kiểm tra")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Mở danh sách thiết bị" }),
  ).toHaveAttribute("href", "/app/devices");
  expect(fetch).not.toHaveBeenCalled();
});
it("exposes a readable error and retries the request", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Kết nối tạm ngắt" } }), {
        status: 503,
      }),
    )
    .mockResolvedValue(new Response(JSON.stringify({ data: report })));
  vi.stubGlobal("fetch", fetch);
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Kết nối tạm ngắt",
  );
  fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  expect(
    await screen.findByText("Số đo có dùng được không?"),
  ).toBeInTheDocument();
});
it("does not show normal advice or full-window totals when raw history is incomplete", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            ...report,
            completeness: { ...report.completeness, truncated: true },
          },
        }),
      ),
    ),
  );
  mount();
  expect(
    await screen.findByText("Chỉ phân tích được một phần lịch sử."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Chưa có việc cần nhắc/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Kết nối$/ }));
  expect(screen.getAllByText("Chưa kết luận")).toHaveLength(3);
});
it("validates a custom range before fetching and separates saved preferences by user", async () => {
  localStorage.setItem(
    "airguard.diagnostics.options.v1.someone-else",
    JSON.stringify({ flat_minutes: 120 }),
  );
  const fetch = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify({ data: report })),
    );
  vi.stubGlobal("fetch", fetch);
  mount();
  await screen.findByText("Số đo có dùng được không?");
  fireEvent.change(screen.getByLabelText("Khoảng thời gian"), {
    target: { value: "custom" },
  });
  const before = fetch.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Xem khoảng này" }));
  expect(await screen.findByText(/Chọn đủ ngày giờ/)).toBeInTheDocument();
  expect(fetch.mock.calls.length).toBe(before);
  fireEvent.click(screen.getByText("Tùy chỉnh kiểm tra"));
  expect(screen.getByLabelText(/Kiểm tra số đo ít thay đổi sau/)).toHaveValue(
    15,
  );
  fireEvent.click(screen.getByRole("button", { name: "Áp dụng tùy chỉnh" }));
  expect(
    JSON.parse(localStorage.getItem("airguard.diagnostics.options.v1.ha")!)
      .flat_minutes,
  ).toBe(15);
});
