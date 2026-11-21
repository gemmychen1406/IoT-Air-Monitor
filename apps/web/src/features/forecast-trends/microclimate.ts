// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import { absoluteHumidity, relativeHumidityFromAbsolute } from './psychrometrics.js';

/** Each node represents a well-mixed room. All rooms have equal *assumed* air volumes. */
export const MICROCLIMATE_ROOMS = [
  { id: 'demo-living', name: 'Phòng khách', baseT: 26.9, baseH: 58 },
  { id: 'demo-bed', name: 'Phòng ngủ', baseT: 26.2, baseH: 56 },
  { id: 'demo-kitchen', name: 'Phòng bếp', baseT: 27.6, baseH: 54 },
  { id: 'demo-bath', name: 'Phòng tắm', baseT: 26.5, baseH: 67 },
] as const;
export type MicroclimateRoomId = (typeof MICROCLIMATE_ROOMS)[number]['id'];
export type MicroclimateEffect = 'temperature' | 'humidity' | 'cooling';

export const MICROCLIMATE_LINKS = [
  { id: 'living-kitchen', a: 'demo-living', b: 'demo-kitchen', label: 'Khách – Bếp' },
  { id: 'living-bed', a: 'demo-living', b: 'demo-bed', label: 'Khách – Ngủ' },
  { id: 'living-bath', a: 'demo-living', b: 'demo-bath', label: 'Khách – Tắm' },
] as const;
export type DoorId = (typeof MICROCLIMATE_LINKS)[number]['id'];
export type DoorStates = Record<DoorId, boolean>;
export const DEFAULT_DOORS: DoorStates = {
  'living-kitchen': true,
  'living-bed': true,
  'living-bath': true,
};

export interface MicroclimateState {
  minute: number;
  rooms: Record<MicroclimateRoomId, { temperature: number; absoluteHumidity: number; humidity: number }>;
}

// EDUCATIONAL/UNCALIBRATED COEFFICIENTS per simulated minute, not measured ventilation rates.
const MODEL = {
  heatExchangeOpen: 0.058,
  heatExchangeClosed: 0.0007,
  moistureExchangeOpen: 0.050,
  moistureExchangeClosed: 0.00025,
  heatRelaxation: 0.009,
  moistureRelaxation: 0.006,
  heatSourcePerMinute: 0.52,
  coolingSourcePerMinute: -0.38,
  moistureSourcePerMinute: 0.25,
};

const eventStrength = (minute: number): number => {
  if (minute >= 27 && minute < 41) return 1;
  if (minute >= 72 && minute < 83) return 0.75;
  if (minute >= 108 && minute < 136) return 1.1;
  return 0;
};

/**
 * Simple discrete multi-room heat/moisture balance, NOT a calibrated physical
 * prediction. The exchange acts on temperature and ABSOLUTE humidity, while
 * RH is derived afterward. Airflow/wall properties, heating power and room
 * volumes are unknown; coefficients are explicit illustration assumptions.
 * No telemetry is read/written here.
 */
export function simulateMicroclimate(
  source: MicroclimateRoomId,
  effect: MicroclimateEffect,
  doors: DoorStates = DEFAULT_DOORS,
  totalMinutes = 150,
): MicroclimateState[] {
  const baseAbs = Object.fromEntries(MICROCLIMATE_ROOMS.map((room) => [room.id, absoluteHumidity(room.baseT, room.baseH)!])) as Record<MicroclimateRoomId, number>;
  let temperatures = Object.fromEntries(MICROCLIMATE_ROOMS.map((room) => [room.id, room.baseT])) as Record<MicroclimateRoomId, number>;
  let moisture = { ...baseAbs };
  const output: MicroclimateState[] = [];
  for (let minute = 0; minute <= totalMinutes; minute++) {
    const rooms = Object.fromEntries(MICROCLIMATE_ROOMS.map((room) => [room.id, {
      temperature: temperatures[room.id],
      absoluteHumidity: moisture[room.id],
      humidity: relativeHumidityFromAbsolute(temperatures[room.id], moisture[room.id])!,
    }])) as MicroclimateState['rooms'];
    output.push({ minute, rooms });
    if (minute === totalMinutes) break;
    const nextT = { ...temperatures };
    const nextA = { ...moisture };
    for (const room of MICROCLIMATE_ROOMS) {
      nextT[room.id] += MODEL.heatRelaxation * (room.baseT - temperatures[room.id]);
      nextA[room.id] += MODEL.moistureRelaxation * (baseAbs[room.id] - moisture[room.id]);
    }
    for (const link of MICROCLIMATE_LINKS) {
      const isOpen = doors[link.id];
      const heatW = isOpen ? MODEL.heatExchangeOpen : MODEL.heatExchangeClosed;
      const moistureW = isOpen ? MODEL.moistureExchangeOpen : MODEL.moistureExchangeClosed;
      const dT = heatW * (temperatures[link.a] - temperatures[link.b]);
      const dA = moistureW * (moisture[link.a] - moisture[link.b]);
      nextT[link.a] -= dT;
      nextT[link.b] += dT;
      nextA[link.a] -= dA;
      nextA[link.b] += dA;
    }
    const strength = eventStrength(minute);
    if (effect === 'temperature') nextT[source] += strength * MODEL.heatSourcePerMinute;
    if (effect === 'cooling') nextT[source] += strength * MODEL.coolingSourcePerMinute;
    if (effect === 'humidity') nextA[source] += strength * MODEL.moistureSourcePerMinute;
    temperatures = nextT;
    moisture = nextA;
  }
  return output;
}
