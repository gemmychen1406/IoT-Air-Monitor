// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { buildDemoScenario, DEMO_ROOMS } from './demoScenario.js';
import { analyzeRoomLag } from './interRoom.js';

const NOW = Date.parse('2026-11-21T09:00:12+07:00');
describe('isolated microclimate demonstration', () => {
  it('creates four distinct simulated DHT histories and a separate future projection', () => {
    const demo = buildDemoScenario(NOW, 'demo-bed', 'humidity');
    expect(demo.devices).toHaveLength(4);
    expect(new Set(demo.devices.map((d) => d.id)).size).toBe(4);
    expect(demo.devices.every((d) => d.source_kind === 'simulator')).toBe(true);
    expect(Object.values(demo.histories).every((history) => history.points.length === 121)).toBe(true);
    expect(demo.projection).toHaveLength(31);
    expect(demo.projection[30]!.minute).toBe(150);
  });
  it('allows each room to originate heat or moisture changes', () => {
    for (const room of DEMO_ROOMS) {
      const demo = buildDemoScenario(NOW, room.id, 'temperature');
      const own = demo.histories[room.id]!.points;
      const range = Math.max(...own.map((p) => p.temperature!)) - Math.min(...own.map((p) => p.temperature!));
      expect(range).toBeGreaterThan(3);
    }
  });
  it('exposes lag analysis as evidence of a statistical relationship, never proof of physical spread', () => {
    const demo = buildDemoScenario(NOW, 'demo-kitchen', 'temperature');
    const relationship = analyzeRoomLag('demo-kitchen', demo.histories['demo-kitchen']!.points,
      'demo-living', demo.histories['demo-living']!.points, 'temperature');
    expect(['candidate', 'not_detected']).toContain(relationship.status);
    expect(relationship.status).not.toBe('insufficient');
  });
});
