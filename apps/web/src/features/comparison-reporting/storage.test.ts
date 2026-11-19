// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { loadConfigurations, saveConfigurations } from "./storage.js";
import type { SavedConfiguration } from "./types.js";

const config: SavedConfiguration = {
  id: "one",
  name: "Phòng học",
  kind: "devices",
  deviceIds: ["device-1", "device-2"],
  metric: "temperature_c",
  range: { from: "2026-11-01T00:00", to: "2026-11-02T00:00", bucket: "hour" },
  timeBasis: "received",
  createdAt: "2026-11-02T00:00:00.000Z",
};

beforeEach(() => localStorage.clear());
it("saves and restores a personal configuration", () => {
  saveConfigurations("user-a", [config]);
  expect(loadConfigurations("user-a")).toEqual([config]);
});
it("does not expose one account configuration to another account", () => {
  saveConfigurations("user-a", [config]);
  expect(loadConfigurations("user-b")).toEqual([]);
});
it("recovers safely from invalid browser storage", () => {
  localStorage.setItem("airguard.comparison-reporting.v1.user-a", "{bad");
  expect(loadConfigurations("user-a")).toEqual([]);
});
