import { describe, expect, it } from 'vitest';
import { stationDisplayName } from './stationDisplay.js';

describe('full unique station labels', () => {
  const cases = [
    ['Bếp · Gần bếp nấu', 'Bếp', 'Bếp · Gần bếp nấu'],
    ['Bếp - Bếp - Giữa bếp', 'Bếp', 'Bếp · Giữa bếp'],
    ['Bếp · Bếp · Gần cửa', 'Bếp', 'Bếp · Gần cửa'],
    ['Phòng khách · Gần cửa sổ', 'Phòng khách', 'Phòng khách · Gần cửa sổ'],
    ['Phòng khách - Khu vực sinh hoạt', 'Phòng khách', 'Phòng khách · Khu vực sinh hoạt'],
    ['Phòng khách · Gần cửa thông sang bếp', 'Phòng khách', 'Phòng khách · Gần cửa thông sang bếp'],
    ['Phòng ngủ · Gần giường', 'Phòng ngủ', 'Phòng ngủ · Gần giường'],
    ['Phòng ngủ - Giữa phòng', 'Phòng ngủ', 'Phòng ngủ · Giữa phòng'],
    ['Phòng ngủ · Gần cửa sổ', 'Phòng ngủ', 'Phòng ngủ · Gần cửa sổ'],
    ['ESP32 Simulator 01', null, 'ESP32 Simulator 01'],
  ] as const;
  it.each(cases)('%s → %s', (name, room, expected) => {
    expect(stationDisplayName(name, room)).toBe(expected);
  });
});
