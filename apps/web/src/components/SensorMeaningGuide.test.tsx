// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it } from "vitest";
import type { DeviceView } from "@iot/contracts";
import { SensorMeaningGuide } from "./SensorMeaningGuide.js";

afterEach(cleanup);
it("does not present offline data as a current normal state", () => {
  const device = {
    id: "device-1",
    name: "Phòng A",
    source_kind: "physical",
    status: "offline",
    last_seen_at: null,
    latest: null,
  } satisfies DeviceView;
  render(<SensorMeaningGuide device={device} />);
  expect(screen.getByText(/Chưa đủ dữ liệu mới/)).toBeInTheDocument();
  expect(
    screen.getByText(/không phải xác nhận môi trường an toàn/),
  ).toBeInTheDocument();
});
