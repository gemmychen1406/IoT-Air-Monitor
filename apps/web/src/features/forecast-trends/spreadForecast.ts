/**
 * Scenario forecast for the shared 9-station AirGuard house.
 * Initial conditions are actual (or simulator-fed) valid, recent DHT11 snapshots.
 * Door states, topology and heat/moisture exchange coefficients are ASSUMPTIONS.
 * This is an illustrative conditional projection, not a calibrated prediction of
 * airflow, physical heat transfer or actual door status. No telemetry is created.
 */
import { absoluteHumidity, relativeHumidityFromAbsolute } from './psychrometrics.js';

export type SpreadRoom = 'kitchen' | 'living' | 'bedroom' | 'other';
export type SpreadEffect = 'none' | 'heat' | 'moisture' | 'both';
export interface SpreadStation {
  id: string;
  name: string;
  room: SpreadRoom;
  temperature: number;
  humidity: number;
}
export interface SpreadDoors { kitchenLiving: boolean; livingBedroom: boolean }
export interface SpreadChoice {
  sourceId: string;
  effect: SpreadEffect;
  doors: SpreadDoors;
  minutes: 15 | 30;
}
export interface SpreadValue {
  id: string;
  temperature: number;
  humidity: number;
  deltaTemperature: number;
  deltaHumidity: number;
}
export interface SpreadFrame { minute: number; stations: SpreadValue[] }
export interface SpreadForecast { frames: SpreadFrame[]; excluded: string[]; links: number }

/** These names are the ones used by tools/device-simulator/src/house-stations.json. */
export function classifySpreadRoom(name: string): SpreadRoom {
  const text = name.trim().toLocaleLowerCase('vi-VN');
  // Prefer the ROOM prefix, because a living-room sensor may be named
  // 'Phòng khách · Gần cửa thông sang bếp' and still belongs to living.
  if (text.startsWith('phòng khách') || text.startsWith('khách')) return 'living';
  if (text.startsWith('phòng ngủ') || text.startsWith('ngủ')) return 'bedroom';
  if (text.startsWith('phòng bếp') || text.startsWith('bếp')) return 'kitchen';
  return 'other';
}

// These are educational sensitivity coefficients per one simulated minute,
// NOT learned from sensor logs or an estimate of ventilation rate.
const WEIGHTS = {
  withinHeat: 0.058,
  withinMoisture: 0.052,
  openHeat: 0.065,
  openMoisture: 0.062,
  closedHeat: 0.00045,
  closedMoisture: 0.00035,
  heatPerMinute: 0.18,           // Assumed active source, °C/min
  moisturePerMinute: 0.09,       // Assumed active source, g/m³/min
  relaxation: 0.002,            // Slow return toward initial conditions
};

function stationRole(station: SpreadStation): number {
  const n = station.name.toLocaleLowerCase('vi-VN');
  if (station.room === 'kitchen') {
    if (n.includes('bếp nấu')) return 0;
    if (n.includes('giữa')) return 1;
    if (n.includes('gần cửa')) return 2;
  }
  if (station.room === 'living') {
    if (n.includes('cửa thông sang bếp')) return 0;
    if (n.includes('sinh hoạt')) return 1;
    if (n.includes('cửa sổ')) return 2;
  }
  if (station.room === 'bedroom') {
    if (n.includes('giữa')) return 0;
    if (n.includes('giường')) return 1;
    if (n.includes('cửa sổ')) return 2;
  }
  return 10;
}

type Edge = { a: number; b: number; heat: number; moisture: number };
function buildEdges(stations: readonly SpreadStation[], doors: SpreadDoors): Edge[] {
  const edges: Edge[] = [];
  const byRoom = new Map<SpreadRoom, number[]>();
  stations.forEach((station, i) => byRoom.set(station.room, [...(byRoom.get(station.room) ?? []), i]));
  // Connect adjacent stations within each room; 3 Bếp => near-stove -> centre -> near-door.
  for (const indices of byRoom.values()) {
    indices.sort((a, b) => stationRole(stations[a]) - stationRole(stations[b]));
    for (let i = 1; i < indices.length; i++) {
      edges.push({ a: indices[i - 1], b: indices[i], heat: WEIGHTS.withinHeat, moisture: WEIGHTS.withinMoisture });
    }
  }
  const closest = (room: SpreadRoom, keyword: string): number | null => {
    const indices = byRoom.get(room) ?? [];
    if (!indices.length) return null;
    // If a door station isn't selected, use another selected station as a coarse substitute.
    return indices.find(i => stations[i].name.toLocaleLowerCase('vi-VN').includes(keyword)) ?? indices[0];
  };
  const connect = (a: number | null, b: number | null, open: boolean) => {
    if (a === null || b === null) return;
    edges.push({
      a, b,
      heat: open ? WEIGHTS.openHeat : WEIGHTS.closedHeat,
      moisture: open ? WEIGHTS.openMoisture : WEIGHTS.closedMoisture,
    });
  };
  connect(closest('kitchen', 'gần cửa'), closest('living', 'cửa thông sang bếp'), doors.kitchenLiving);
  connect(closest('living', 'sinh hoạt'), closest('bedroom', 'giữa phòng'), doors.livingBedroom);
  return edges;
}

export function simulateSpread(stations: readonly SpreadStation[], choice: SpreadChoice): SpreadForecast {
  // Silently exclude invalid readings: never fabricate temperatures or humidity.
  const valid = stations.filter(s => Number.isFinite(s.temperature)
    && s.temperature >= -40 && s.temperature <= 80
    && Number.isFinite(s.humidity) && s.humidity >= 0 && s.humidity <= 100
    && absoluteHumidity(s.temperature, s.humidity) !== null);
  const excluded = stations.filter(s => !valid.some(v => v.id === s.id)).map(s => s.id);
  if (valid.length < 2 || !valid.some(s => s.id === choice.sourceId)) return { frames: [], excluded, links: 0 };

  const edges = buildEdges(valid, choice.doors);
  const startT = valid.map(s => s.temperature);
  const startA = valid.map(s => absoluteHumidity(s.temperature, s.humidity)!);
  let t = [...startT];
  let a = [...startA];
  const sourceIndex = valid.findIndex(s => s.id === choice.sourceId);
  const frames: SpreadFrame[] = [];

  for (let minute = 0; minute <= choice.minutes; minute++) {
    if (minute % 5 === 0 || minute === choice.minutes) {
      frames.push({ minute, stations: valid.map((station, i) => {
        // Minute 0 must equal the actual sensor payload exactly (not a roundtrip approximation).
        const humidity = minute === 0 ? station.humidity : (relativeHumidityFromAbsolute(t[i], a[i]) ?? station.humidity);
        return {
          id: station.id, temperature: t[i], humidity,
          deltaTemperature: t[i] - startT[i], deltaHumidity: humidity - station.humidity,
        };
      }) });
    }
    if (minute === choice.minutes) break;
    const nextT = [...t];
    const nextA = [...a];
    for (let i = 0; i < t.length; i++) {
      nextT[i] += WEIGHTS.relaxation * (startT[i] - t[i]);
      nextA[i] += WEIGHTS.relaxation * (startA[i] - a[i]);
    }
    for (const edge of edges) {
      const heatFlow = (t[edge.a] - t[edge.b]) * edge.heat;
      const moistureFlow = (a[edge.a] - a[edge.b]) * edge.moisture;
      nextT[edge.a] -= heatFlow;
      nextT[edge.b] += heatFlow;
      nextA[edge.a] -= moistureFlow;
      nextA[edge.b] += moistureFlow;
    }
    if (choice.effect === 'heat' || choice.effect === 'both') nextT[sourceIndex] += WEIGHTS.heatPerMinute;
    if (choice.effect === 'moisture' || choice.effect === 'both') nextA[sourceIndex] += WEIGHTS.moisturePerMinute;
    t = nextT;
    a = nextA;
  }
  return { frames, excluded, links: edges.length };
}
