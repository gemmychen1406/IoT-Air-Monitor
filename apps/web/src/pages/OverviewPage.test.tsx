// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
        : { opened: 4, ended: 3 },
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <OverviewPage
          devices={devices}
          alerts={[
            {
              device_id: "c",
              incident_id: "fire",
              condition: "flame",
              unresolved: true,
              updated_at: payload.sampled_at,
            },
          ]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Phòng mới" });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.queryByRole("heading", { name: "Ban công" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Phòng cũ" })).toBeNull();
  screen.getByText(/Sự cố và tình trạng thiết bị/).click();
  await screen.findAllByText("Bếp · Trạm C · Mô phỏng");
  const first = within(screen.getAllByRole("listitem")[0]!);
  expect(first.getByText("Cảnh báo lửa")).toBeInTheDocument();
  expect(first.getByRole("link")).toHaveAttribute("href", "/app/alerts/fire");
  for (const [reason, id] of [
    ["Chưa gửi dữ liệu lần nào", "a"],
    ["Mất kết nối", "b"],
    ["Dữ liệu cũ", "c"],
  ] as const) {
    expect(
      within(screen.getByText(reason).closest("li")!).getByRole("link"),
    ).toHaveAttribute("href", "/app/monitoring/" + id);
  }
  expect(screen.getByText(/0\/2 khu vực có đủ tín hiệu/)).toBeInTheDocument();
  expect(screen.getByText(/sự cố phát sinh/)).toHaveTextContent(
    "4 sự cố phát sinh · 3 sự cố đã kết thúc",
  );
});
