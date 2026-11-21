// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DOORS, MICROCLIMATE_ROOMS, simulateMicroclimate } from './microclimate.js';
import type { DoorStates } from './microclimate.js';

const allClosed: DoorStates = { 'living-kitchen': false, 'living-bed': false, 'living-bath': false };

describe('assumption-driven inter-room heat and water-vapor exchange', () => {
  it('simulates four unique rooms for 151 minutes without invalid values', () => {
    const result = simulateMicroclimate('demo-bed', 'humidity');
    expect(result).toHaveLength(151);
    for (const room of MICROCLIMATE_ROOMS) {
      expect(result.every((state) => Number.isFinite(state.rooms[room.id].temperature))).toBe(true);
      expect(result.every((state) => state.rooms[room.id].humidity >= 0 && state.rooms[room.id].humidity <= 100)).toBe(true);
    }
  });
  it('responds less in other rooms when connecting doors are closed', () => {
    const open = simulateMicroclimate('demo-kitchen', 'temperature', DEFAULT_DOORS);
    const closed = simulateMicroclimate('demo-kitchen', 'temperature', allClosed);
    const baseline = open[0]!.rooms['demo-living'].temperature;
    expect(open[150]!.rooms['demo-living'].temperature - baseline).toBeGreaterThan(closed[150]!.rooms['demo-living'].temperature - baseline + 1);
  });
  it('increasing absolute humidity drives neighbors without directly forcing temperature', () => {
    const humid = simulateMicroclimate('demo-bath', 'humidity');
    const idle = humid[0]!.rooms['demo-living'];
    const later = humid[150]!.rooms['demo-living'];
    expect(later.absoluteHumidity).toBeGreaterThan(idle.absoluteHumidity + 0.2);
  });
  it('cooling can affect adjacent rooms and changes RH even without moisture creation', () => {
    const cooling = simulateMicroclimate('demo-bed', 'cooling');
    expect(cooling[150]!.rooms['demo-living'].temperature).toBeLessThan(cooling[0]!.rooms['demo-living'].temperature);
    expect(cooling[150]!.rooms['demo-bed'].humidity).toBeGreaterThan(cooling[0]!.rooms['demo-bed'].humidity);
  });
  it('allows every room to act as a source instead of hard coding the kitchen', () => {
    for (const room of MICROCLIMATE_ROOMS) {
      const result = simulateMicroclimate(room.id, 'temperature');
      expect(result[120]!.rooms[room.id].temperature).toBeGreaterThan(result[0]!.rooms[room.id].temperature + 3);
    }
  });
});
