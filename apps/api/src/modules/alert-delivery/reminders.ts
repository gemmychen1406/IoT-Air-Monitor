import { Prisma } from '@prisma/client';
import type { Database } from '@iot/database';

// Advance the last completed round per destination. A pending/retrying round blocks its successor.
export async function scheduleCriticalReminders(
  db: Database,
  channel: 'telegram' | 'webpush',
  seconds: number,
  now = new Date(),
) {
  const push = channel === 'webpush';
  const table = push ? Prisma.sql`web_push_deliveries` : Prisma.sql`telegram_notifications`;
  const destination = push ? Prisma.sql`, subscription_id` : Prisma.empty;
  const same = push ? Prisma.sql`AND n.subscription_id = d.subscription_id` : Prisma.empty;
  const cutoff = new Date(now.getTime() - seconds * 1000);
  return db.$executeRaw`INSERT INTO ${table}
    (id, incident_id, severity, round, created_at, next_attempt_at, expires_at ${destination})
    SELECT gen_random_uuid(), d.incident_id, 'critical', d.round + 1, ${now}, ${now},
      ${new Date(now.getTime() + 6 * 3600000)} ${destination}
    FROM ${table} d JOIN alert_incidents i ON i.id = d.incident_id
    WHERE d.severity='critical' AND i.status='active' AND i.severity='critical'
      AND d.status IN ('sent','failed','expired') AND COALESCE(d.sent_at,d.next_attempt_at,d.created_at) <= ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM alert_receipts r WHERE r.incident_id=i.id)
      AND NOT EXISTS (SELECT 1 FROM ${table} n WHERE n.incident_id=d.incident_id AND n.severity='critical'
        AND n.round>d.round ${same})
    ORDER BY d.created_at LIMIT 100 ON CONFLICT DO NOTHING`;
}
