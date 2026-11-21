import type { Prisma } from '@prisma/client';
import { environmentPolicyInput, type EnvironmentPolicy } from '@iot/contracts';

export const minute = 60_000;
export type EnvironmentAvailability = {
  telegram: boolean;
  telegramSimulators: boolean;
  pushPublicKey?: string;
};

const clocks = new Map<string, Intl.DateTimeFormat>();
function minuteOfDay(at: Date, timeZone: string) {
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (clocks.size >= 64) clocks.clear();
    clocks.set(timeZone, clock);
  }
  const [hour, min] = clock.format(at).split(':').map(Number);
  return hour! * 60 + min!;
}
const parseTime = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function quietEnd(policy: Pick<EnvironmentPolicy, 'quiet' | 'timezone'>, at: Date) {
  if (!policy.quiet) return null;
  const start = parseTime(policy.quiet.start);
  const end = parseTime(policy.quiet.end);
  const inside = (date: Date) => {
    const value = minuteOfDay(date, policy.timezone);
    return start < end ? value >= start && value < end : value >= start || value < end;
  };
  if (!inside(at)) return null;
  // Follow the real local clock, including skipped/repeated wall-clock minutes.
  const first = Math.floor(at.getTime() / minute) * minute + minute;
  for (let t = first; t <= first + 27 * 60 * minute; t += minute) {
    const step = new Date(t);
    if (!inside(step)) return step;
  }
  return new Date(first + 27 * 60 * minute);
}

export function digestSlot(started: Date, now: Date, intervalMinutes: number) {
  const interval = intervalMinutes * minute;
  const slot = Math.floor((now.getTime() - started.getTime()) / interval);
  return slot >= 1 ? new Date(started.getTime() + slot * interval) : null;
}

export function nextDigest(started: Date, now: Date, intervalMinutes: number) {
  const last = digestSlot(started, now, intervalMinutes) ?? started;
  return new Date(last.getTime() + intervalMinutes * minute);
}

export async function alertQuietUntil(tx: Prisma.TransactionClient, userId: string | null, severity: string, at: Date) {
  const row = await tx.environmentPolicy.findUnique({
    where: { id: userId ? `webpush:${userId}` : 'telegram' },
    select: { config: true },
  });
  if (!row) return null;
  const rule = environmentPolicyInput.parse(row.config);
  if (!rule.quiet_incidents || (severity === 'critical' && rule.critical_bypass)) return null;
  return quietEnd(rule, at);
}

export async function lockEnvironmentPolicy(tx: Prisma.TransactionClient, id: string, wait = false) {
  if (wait) {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${id}, 661006))`;
    return true;
  }
  const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${id}, 661006)) AS locked
  `;
  return !!row?.locked;
}

export function eligiblePushes(tx: Prisma.TransactionClient, userId: string, key: string, at: Date, simulator = false) {
  return tx.webPushSubscription.findMany({
    where: {
      vapidPublicKey: key,
      ...(simulator ? { includeSimulators: true } : {}),
      session: { userId, user: { active: true } },
      OR: [{browserHash:{not:null}},{session:{expiresAt:{gt:at}}}],
    },
    select: { id: true },
  });
}
