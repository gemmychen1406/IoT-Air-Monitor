import type { Prisma, SupportContact } from '@prisma/client';
import type { ContactView } from '@iot/contracts';
import { assertActiveSpace, requireArea, requireRoom } from '../monitoring-spaces/store.js';

export function contactView(row: SupportContact): ContactView {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    phone: row.phone,
    description: row.description,
    priority: row.priority,
    scope: row.roomId ? { kind: 'room', id: row.roomId }
      : row.areaId ? { kind: 'area', id: row.areaId } : { kind: 'global' },
    archived_at: row.archivedAt?.toISOString() ?? null,
  };
}

export function scopeIds(scope: ContactView['scope']) {
  return {
    areaId: scope.kind === 'area' ? scope.id : null,
    roomId: scope.kind === 'room' ? scope.id : null,
  };
}

export async function validateScope(
  tx: Prisma.TransactionClient,
  scope: ContactView['scope'],
  requireActive: boolean,
) {
  if (scope.kind === 'area') {
    const area = await requireArea(tx, scope.id);
    if (requireActive) assertActiveSpace(area.archivedAt);
  }
  if (scope.kind === 'room') {
    const room = await requireRoom(tx, scope.id);
    if (requireActive) assertActiveSpace(room.archivedAt ?? room.area.archivedAt);
  }
}

const scopeRank = { room: 0, area: 1, global: 2 };

export function prioritizeContacts(rows: ContactView[]): ContactView[] {
  const ordered = [...rows].sort((a, b) =>
    scopeRank[a.scope.kind] - scopeRank[b.scope.kind] ||
    a.priority - b.priority ||
    a.name.localeCompare(b.name, 'vi') ||
    a.id.localeCompare(b.id),
  );
  const seen = new Set<string>();
  return ordered.filter(({ phone }) => {
    if (seen.has(phone)) return false;
    seen.add(phone);
    return true;
  });
}
