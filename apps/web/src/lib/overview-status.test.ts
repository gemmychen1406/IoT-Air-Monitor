import { expect, it } from "vitest";
import type { DeviceView, ReadingView, SpacesView } from "@iot/contracts";
import { overviewStatus, type OpenIncident } from "./overview-status.js";
import { roomAir } from "./room-air.js";

const now = Date.parse("2026-09-10T08:00:00Z");
const timestamp = new Date(now).toISOString();
const gas = {
  adc_raw: 250,
  adc_bits: 12,
  adc_pin_mv: null,
  quality: "valid",
  age_ms: 0,
  concentration_ppm: null,
} as const;
const reading: ReadingView = {
  id: "reading",
  received_at: timestamp,
  payload: {
    boot_id: "0d100a20-9fa2-475a-93dc-663389e3be7a",
    boot_counter: "1",
    seq: "1",
    uptime_ms: "1000",
    sampled_at: timestamp,
    time_quality: "synced",
    firmware_version: "demo",
    config_version: 1,
    sensors: {
      mq2: gas,
      mq7: { ...gas, heater_control: "controlled" },
      flame: { detected: false, quality: "valid", age_ms: 0 },
      dht11: {
        temperature_c: 25,
        humidity_pct: 53,
        quality: "valid",
        age_ms: 0,
      },
    },
    alert_snapshot: {
      gas: "normal",
      co: "normal",
      flame: "normal",
      buzzer_commanded_on: false,
    },
  },
};
const station: DeviceView = {
  id: "station",
  name: "Trạm bếp",
  source_kind: "simulator",
  status: "online",
  last_seen_at: timestamp,
  latest: reading,
};
const areas = ["house", "garage"].map((id) => ({
  id,
  name: id,
  description: "",
  created_at: timestamp,
  updated_at: timestamp,
  archived_at: null,
}));
const spaces: SpacesView = {
  areas,
  rooms: areas.map((area) => ({
    ...area,
    id: area.id + "-room",
    area_id: area.id,
  })),
  devices: [
    { ...station, location: "", archived_at: null, room_id: "house-room" },
  ],
};
const fire: OpenIncident = {
  device_id: station.id,
  incident_id: "fire",
  condition: "flame",
  severity: "critical",
  unresolved: true,
  updated_at: timestamp,
};

it("counts a room as covered only while both gas readings are available", () => {
  expect(roomAir([station], now)).toMatchObject({
    complete: true,
    label: "Bình thường",
  });
  expect(roomAir([station], now + 16000)).toMatchObject({
    complete: false,
    rank: 0,
  });
  expect(roomAir([{ ...station, status: "offline" }], now)).toMatchObject({
    complete: false,
    rank: -1,
  });
});

it("shows a reported gas alert without counting an invalid measurement towards coverage", () => {
  const alertReading: ReadingView = {
    ...reading,
    payload: {
      ...reading.payload,
      sensors: {
        ...reading.payload.sensors,
        mq2: { ...gas, adc_raw: null, quality: "invalid" },
      },
      alert_snapshot: { ...reading.payload.alert_snapshot, gas: "active" },
    },
  };
  expect(roomAir([{ ...station, latest: alertReading }], now)).toMatchObject({
    complete: false,
    rank: 2,
    label: "Cảnh báo",
  });
});

it("groups room cards in area picker order before sorting their names", () => {
  const [house, garage] = areas;
  const titledRooms = [
    { ...house, id: "kitchen", name: "Bếp", area_id: house.id },
    { ...garage, id: "demo-b", name: "Phòng B", area_id: garage.id },
    { ...house, id: "bedroom", name: "Phòng ngủ", area_id: house.id },
    { ...garage, id: "demo-a", name: "Phòng A", area_id: garage.id },
  ];
  const status = overviewStatus({ ...spaces, rooms: titledRooms }, [], [], now);
  expect(status.groups.map((area) => area.id)).toEqual(["garage", "house"]);
  expect(status.rooms.map(({ room }) => room.id)).toEqual([
    "demo-a",
    "demo-b",
    "kitchen",
    "bedroom",
  ]);
});

it("keeps a critical incident visible with missing readings or a missing room assignment", () => {
  const offline = { ...station, status: "offline", latest: null } as const;
  const unassigned = { ...spaces, devices: [] };
  expect(overviewStatus(spaces, [offline], [fire], now)).toMatchObject({
    totalTone: "danger",
    groups: [
      { id: "garage", tone: "unknown" },
      { id: "house", tone: "danger" },
    ],
    rooms: [
      { complete: false, incident: undefined },
      { complete: false, incident: fire },
    ],
  });
  expect(overviewStatus(unassigned, [offline], [fire], now)).toMatchObject({
    totalTone: "danger",
    incidents: [
      { ...fire, station: { room: undefined, location: "Chưa gán phòng" } },
    ],
  });
});
