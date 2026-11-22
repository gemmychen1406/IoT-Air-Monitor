import { describe, expect, it } from 'vitest';
import { classifySpreadRoom, simulateSpread, type SpreadStation } from './spreadForecast.js';

const stations: SpreadStation[] = [
  { id: 'stove', name: 'Bếp · Gần bếp nấu', room: 'kitchen', temperature: 31, humidity: 51 },
  { id: 'k-mid', name: 'Bếp · Giữa bếp', room: 'kitchen', temperature: 27, humidity: 53 },
  { id: 'k-door', name: 'Bếp · Gần cửa', room: 'kitchen', temperature: 25.5, humidity: 55 },
  { id: 'l-door', name: 'Phòng khách · Gần cửa thông sang bếp', room: 'living', temperature: 23, humidity: 56 },
  { id: 'l-mid', name: 'Phòng khách · Khu vực sinh hoạt', room: 'living', temperature: 23.5, humidity: 56 },
  { id: 'b-mid', name: 'Phòng ngủ · Giữa phòng', room: 'bedroom', temperature: 23, humidity: 58 },
];
const setup = (open: boolean, minutes: 15 | 30 = 30, effect = 'heat' as const) => simulateSpread(stations, {
  sourceId: 'stove', effect,
  doors: { kitchenLiving: open, livingBedroom: open }, minutes,
});
const resultAt = (open: boolean, id: string, minutes: 15 | 30 = 30) => {
  const result = setup(open, minutes).frames.at(-1)?.stations.find(s => s.id === id);
  if (!result) throw new Error('Missing station in forecast');
  return result;
};

describe('spread scenario projection (not measured actual future)', () => {
  it('respects room prefix even if a living-room position contains the word "bếp"', () => {
    expect(classifySpreadRoom('Phòng khách · Gần cửa thông sang bếp')).toBe('living');
    expect(classifySpreadRoom('Bếp · Gần cửa')).toBe('kitchen');
  });
  it('starts from supplied measurements exactly, not old fixed demo-room values', () => {
    const initial = setup(true).frames[0];
    expect(initial.stations.find(s => s.id === 'stove')?.temperature).toBe(31);
    expect(initial.stations.find(s => s.id === 'l-door')?.humidity).toBe(56);
  });
  it('moves heat across an opened kitchen-living door faster than a closed door', () => {
    expect(resultAt(true, 'l-door').temperature).toBeGreaterThan(resultAt(false, 'l-door').temperature + 0.5);
    expect(resultAt(true, 'k-door').temperature).toBeLessThan(resultAt(false, 'k-door').temperature);
  });
  it('shows a delayed effect in living and bedroom when both doors are open', () => {
    expect(resultAt(true, 'l-mid', 30).temperature).toBeGreaterThan(resultAt(true, 'l-mid', 15).temperature);
    expect(resultAt(true, 'b-mid', 30).temperature).toBeGreaterThan(resultAt(true, 'b-mid', 15).temperature);
  });
  it('uses 0,5,10,15,20,25,30 minute outputs for a 30-minute scenario', () => {
    expect(setup(true).frames.map(frame => frame.minute)).toEqual([0, 5, 10, 15, 20, 25, 30]);
  });
  it('does not create placeholder station data for invalid readings', () => {
    const result = simulateSpread([...stations, { id: 'bad', name: 'Bếp · Lỗi', room: 'kitchen', temperature: NaN, humidity: 60 }], {
      sourceId: 'stove', effect: 'none', doors: { kitchenLiving: false, livingBedroom: false }, minutes: 15,
    });
    expect(result.excluded).toContain('bad');
    expect(result.frames[0].stations).toHaveLength(stations.length);
  });
  it('refuses to run when fewer than two valid stations are selected', () => {
    const onlyOne = simulateSpread(stations.slice(0, 1), { sourceId: 'stove', effect: 'heat', doors: { kitchenLiving: true, livingBedroom: true }, minutes: 15 });
    expect(onlyOne.frames).toEqual([]);
  });
  it('does not invent a link between kitchen and bedroom without a living-room station', () => {
    const sparse = simulateSpread(stations.filter(s => s.room !== 'living'), {
      sourceId: 'stove', effect: 'heat', doors: { kitchenLiving: true, livingBedroom: true }, minutes: 15,
    });
    const bedroom = sparse.frames.at(-1)?.stations.find(s => s.id === 'b-mid');
    expect(bedroom?.deltaTemperature).toBeCloseTo(0, 6);
  });
});
