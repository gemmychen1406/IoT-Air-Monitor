// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { telemetrySchema, type DeviceView } from "@iot/contracts";
import { samplePayload } from "../../../../packages/contracts/tests/fixture.js";
import OverviewPage from "./OverviewPage.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("prioritizes open incidents, distinguishes missing data and links to the affected station", async () => {
  const payload = telemetrySchema.parse(samplePayload()).readings[0]!;
  payload.sampled_at = new Date(Date.now() - 120000).toISOString();
  const devices: DeviceView[] = [
    {
      id: "a",
      name: "Trạm A",
      location: "Ban công",
      source_kind: "physical",
      last_seen_at: null,
      latest: null,
      status: "never_seen",
    },
    {
      id: "b",
      name: "Trạm B",
      source_kind: "physical",
      last_seen_at: payload.sampled_at,
      latest: null,
      status: "offline",
    },
    {
      id: "c",
      name: "Trạm C",
      source_kind: "simulator",
      last_seen_at: payload.sampled_at,
      latest: { id: "r", received_at: payload.sampled_at, payload },
      status: "online",
    },
  ];
  vi.stubGlobal("fetch", async (url: string) =>
    Response.json({
      data: url.endsWith("/spaces")
        ? {
            areas: [{ id: "home", name: "Nhà" }],
            rooms: [
              { id: "room", name: "Bếp", area_id: "home" },
              { id: "empty", name: "Phòng mới", area_id: "home" },
              {
                id: "old",
                name: "Phòng cũ",
                area_id: "home",
                archived_at: payload.sampled_at,
              },
            ],
            devices: [{ id: "c", room_id: "room" }],
          }
        : url.includes("/alerts/incidents?")
          ? [
              {
                id: "fire",
                device_id: "c",
                condition: "flame",
                severity: "critical",
                started_at: payload.sampled_at,
              },
            ]
          : { opened: 4, ended: 3 },
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <OverviewPage devices={devices} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Phòng mới" });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.queryByRole("heading", { name: "Ban công" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Phòng cũ" })).toBeNull();
  await screen.findByRole("heading", { name: "Có dấu hiệu nguy hiểm" });
  const attention = within(
    screen.getByRole("complementary", { name: "Cần chú ý" }),
  );
  const first = within(attention.getAllByRole("listitem")[0]!);
  expect(first.getByText("Trạm C")).toBeInTheDocument();
  expect(first.getByText("Phát hiện lửa")).toBeInTheDocument();
  expect(first.getByText("Nhà / Bếp · Mô phỏng")).toBeInTheDocument();
  expect(first.getByRole("link")).toHaveAttribute("href", "/app/alerts/fire");
  expect(
    screen.getByRole("link", { name: /Xem sơ đồ phòng Bếp/ }),
  ).toHaveAttribute("href", "/app/spaces/home#ag-map-room-room");
  fireEvent.click(attention.getByRole("button", { name: /Xem thêm/ }));
  for (const [reason, id] of [
    ["Chưa gửi dữ liệu", "a"],
    ["Mất kết nối", "b"],
    ["Dữ liệu cũ", "c"],
  ] as const) {
    expect(
      within(attention.getByText(reason).closest("li")!).getByRole("link"),
    ).toHaveAttribute("href", "/app/monitoring/" + id);
  }
  expect(screen.getByText("0/2 phòng có đủ số đo")).toBeInTheDocument();
  const history = within(
    screen.getByRole("region", { name: "Diễn biến 24 giờ qua" }),
  );
  expect(history.getByText("4")).toBeInTheDocument();
  expect(history.getByText("3")).toBeInTheDocument();
  const detailUrl = new URL(
    history.getByRole("link", { name: "Xem chi tiết" }).getAttribute("href")!,
    "http://localhost",
  );
  const { pathname, searchParams } = detailUrl;
  expect(pathname).toBe("/app/alerts");
  expect(
    Date.parse(searchParams.get("to")!) - Date.parse(searchParams.get("from")!),
  ).toBe(86400000);
});
