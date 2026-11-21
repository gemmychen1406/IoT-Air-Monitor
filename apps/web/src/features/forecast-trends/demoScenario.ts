// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import type { DeviceView, Reading } from '@iot/contracts';
import { FORECAST_CONFIG as CFG } from './config.js';
import {
  DEFAULT_DOORS, MICROCLIMATE_ROOMS, simulateMicroclimate,
} from './microclimate.js';
import type { DoorStates, MicroclimateEffect, MicroclimateRoomId, MicroclimateState } from './microclimate.js';
import type { Measure, MinuteReading, NormalizedHistory } from './types.js';

/** Browser-only exercise, never sent to the server or represented as real telemetry. */
export const DEMO_ROOMS = MICROCLIMATE_ROOMS;
export type DemoRoomId = MicroclimateRoomId;
export type DemoEffect = MicroclimateEffect;

/** A read-only DHT11 preview for the browser demo, not an ingestible telemetry payload.
 * The group contract includes other sensor fields, so keep the narrow preview local.
 */
function makePayload(time: number, temperature: number, humidity: number): Reading {
  return {
    sampled_at: new Date(time).toISOString(),
    time_quality: 'synced',
    sensors: {
      dht11: { temperature_c: temperature, humidity_pct: humidity, quality: 'valid', age_ms: 0 },
    },
  } as Reading;
}

export interface DemoScenario {
  devices: DeviceView[];
  histories: Record<string, NormalizedHistory>;
  sourceId: DemoRoomId;
  metric: Measure;
  effect: DemoEffect;
  doors: DoorStates;
  /** Model-only projection. Times after the 120th minute are NOT observations. */
  projection: MicroclimateState[];
}

/** Uncalibrated room-network balance; optional door assumptions affect the entire replay. */
export function buildDemoScenario(
  nowMs: number,
  sourceId: DemoRoomId,
  effect: DemoEffect,
  doors: DoorStates = DEFAULT_DOORS,
): DemoScenario {
  const end = Math.floor(nowMs / CFG.minuteMs) * CFG.minuteMs;
  const start = end - 120 * CFG.minuteMs;
  const histories: Record<string, NormalizedHistory> = {};
  const devices: DeviceView[] = [];
  const simulated = simulateMicroclimate(sourceId, effect, doors, 150);
  for (const room of DEMO_ROOMS) {
    const points: MinuteReading[] = simulated.slice(0, 121).map((minute) => {
      const { temperature, humidity } = minute.rooms[room.id];
      return {
        timestamp: start + minute.minute * CFG.minuteMs,
        temperature: Math.round(temperature * 100) / 100,
        humidity: Math.round(humidity * 100) / 100,
        temperatureMa: null, humidityMa: null, count: 1,
      };
    });
    for (let i = 2; i < points.length; i++) {
      points[i]!.temperatureMa = (points[i]!.temperature! + points[i - 1]!.temperature! + points[i - 2]!.temperature!) / 3;
      points[i]!.humidityMa = (points[i]!.humidity! + points[i - 1]!.humidity! + points[i - 2]!.humidity!) / 3;
    }
    const last = points.at(-1)!;
    histories[room.id] = {
      points, validSamples: points.length, rejectedSamples: 0, duplicateTimestamps: 0,
      latestSampleAt: last.timestamp, latestReceivedAt: last.timestamp,
    };
    devices.push({
      id: room.id, name: room.name, location: room.name, source_kind: 'simulator',
      last_seen_at: new Date(nowMs).toISOString(), status: 'online',
      latest: { id: `demo-${room.id}`, received_at: new Date(nowMs).toISOString(), payload: makePayload(nowMs, last.temperature!, last.humidity!) },
    });
  }
  return { devices, histories, sourceId, effect, metric: effect === 'humidity' ? 'humidity' : 'temperature', doors, projection: simulated.slice(120) };
}
