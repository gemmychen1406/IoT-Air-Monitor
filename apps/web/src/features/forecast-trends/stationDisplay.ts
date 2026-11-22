/** A single station name on every Forecast UI surface, without doubling the room name. */
export function stationDisplayName(deviceName: string, assignedRoom: string | null | undefined): string {
  const rawName = deviceName.trim();
  const room = (assignedRoom ?? '').trim();
  if (!room) return rawName;
  let place = rawName;
  // Data may already include room as prefix once or repeatedly, with either "·" or "-".
  for (let count = 0; count < 5; count++) {
    if (!place.toLocaleLowerCase('vi-VN').startsWith(room.toLocaleLowerCase('vi-VN'))) break;
    const remaining = place.slice(room.length);
    const match = remaining.match(/^\s*[·.\-–—:]\s*/u);
    if (!match) break;
    place = remaining.slice(match[0].length).trim();
  }
  if (!place || place.toLocaleLowerCase('vi-VN') === room.toLocaleLowerCase('vi-VN')) return rawName;
  return `${room} · ${place}`;
}
