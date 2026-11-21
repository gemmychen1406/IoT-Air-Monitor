import type { Database } from '@iot/database';
import type { EnvironmentDeviceState, EnvironmentPolicy as StoredPolicy, Prisma } from '@prisma/client';
import { environmentPolicyInput, type EnvironmentKind, type EnvironmentPolicy } from '@iot/contracts';
import { digestSlot, eligiblePushes, lockEnvironmentPolicy, minute, type EnvironmentAvailability } from './policy.js';

type DeviceSnapshot = {
  id: string; name: string; sourceKind: 'physical' | 'simulator'; location: string; reportingIntervalMs: number;
  roomAssignment: { room: { name: string; area: { name: string } } } | null;
};
type Event = {
  kind: EnvironmentKind; key: string; at: Date; expires: Date; summary: string;
};
type Bucket = {
  at: Date; count: number; temperature: number; humidity: number;
  minTemp: number; maxTemp: number; minHumidity: number; maxHumidity: number;
};
const fixed = (v: number) => v.toFixed(1);
const sampleFreshness = (device: DeviceSnapshot) => Math.max(device.reportingIntervalMs * 3, 120_000);

async function sampleBuckets(
  tx: Prisma.TransactionClient, device: DeviceSnapshot, from: Date, to: Date, perMinute: boolean,
) {
  const freshness = sampleFreshness(device);
  return tx.$queryRaw<Bucket[]>`
    SELECT CASE WHEN ${perMinute} THEN date_trunc('minute', sampled_at, 'UTC') ELSE ${from}::timestamptz END AS at,
      COUNT(*)::int AS count, AVG(temperature_c)::float8 AS temperature, AVG(humidity_pct)::float8 AS humidity,
      MIN(temperature_c)::float8 AS "minTemp", MAX(temperature_c)::float8 AS "maxTemp",
      MIN(humidity_pct)::float8 AS "minHumidity", MAX(humidity_pct)::float8 AS "maxHumidity"
    FROM sensor_readings
    WHERE device_id=${device.id}::uuid AND sampled_at>=${from} AND sampled_at<${to}
      AND received_at <= ${to}::timestamptz + ${freshness} * INTERVAL '1 millisecond'
      AND received_at - sampled_at <= ${freshness} * INTERVAL '1 millisecond'
      AND payload #>> '{sensors,dht11,quality}' = 'valid'
      AND (payload #>> '{sensors,dht11,age_ms}')::int <= ${freshness}
      AND temperature_c IS NOT NULL AND humidity_pct IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `;
}

export function variationSummary(
  series: Pick<Bucket, 'at' | 'count' | 'temperature' | 'humidity'>[],
  ending: Date,
  config: EnvironmentPolicy['variation'],
) {
  const size = config.sustain_minutes;
  const from = ending.getTime() - 2 * size * minute;
  if (series.length !== 2 * size || series.some((bucket, i) => bucket.at.getTime() !== from + i * minute))
    return null;
  const reference = series.slice(0, size);
  const recent = series.slice(size);
  const measure = (metric: 'temperature' | 'humidity', threshold: number, label: string, unit: string) => {
    const baseline = reference.reduce((n, b) => n + b[metric] * b.count, 0) /
      reference.reduce((n, b) => n + b.count, 0);
    const changes = recent.map((b) => b[metric] - baseline);
    if (!changes.every((x) => x >= threshold) && !changes.every((x) => x <= -threshold)) return null;
    return `${label} ${changes[0]! > 0 ? '+' : ''}${fixed(changes.at(-1)!)} ${unit}`;
  };
  const matches = [
    measure('temperature', config.temperature_delta, 'Nhiệt độ', '°C'),
    measure('humidity', config.humidity_delta, 'Độ ẩm', 'điểm %RH'),
  ].filter(Boolean);
  return matches.length ? `${matches.join(' · ')}. Duy trì ${size} phút so với ${size} phút trước đó.` : null;
}

function deliveryData(stored: StoredPolicy, device: DeviceSnapshot, event: Event, now: Date) {
  const room = device.roomAssignment?.room;
  return {
    policyId: stored.id, channel: stored.channel, userId: stored.userId,
    deviceId: device.id, deviceName: device.name, simulator: device.sourceKind === 'simulator',
    location: room ? `${room.area.name} / ${room.name}` : device.location.trim() || null,
    kind: event.kind, sourceKey: event.key, summary: event.summary, occurredAt: event.at,
    createdAt: now, nextAttemptAt: now, expiresAt: event.expires,
  };
}

async function enqueue(
  tx: Prisma.TransactionClient, stored: StoredPolicy, device: DeviceSnapshot,
  event: Event, availability: EnvironmentAvailability, now: Date,
) {
  const data = deliveryData(stored, device, event, now);
  const telegram = stored.channel === 'telegram';
  const configured = telegram ? availability.telegram : !!availability.pushPublicKey;
  const allowed = !data.simulator || !telegram || availability.telegramSimulators;
  const targets = configured && allowed
    ? telegram ? [{ id: 'workspace' }] : await eligiblePushes(tx, stored.userId!, availability.pushPublicKey!, now, data.simulator)
    : [];
  // At most one pending digest/variation per policy, device and kind. A leased send
  // is left to its owner. Its retry is superseded before it can send again.
  if (event.kind === 'digest' || event.kind === 'variation') {
    await tx.environmentDelivery.updateMany({
      where: { policyId: stored.id, deviceId: device.id, kind: event.kind, sourceKey: { not: event.key }, status: 'pending' },
      data: { status: 'skipped', lastErrorCode: 'SUPERSEDED' },
    });
  }
  await tx.environmentDelivery.createMany({
    data: targets.length ? targets.map(({ id }) => ({
      ...data, targetKey: id, subscriptionId: telegram ? null : id,
    })) : [{
      ...data, targetKey: 'none', status: 'skipped',
      lastErrorCode: !configured ? 'CHANNEL_DISABLED' : !allowed ? 'SIMULATOR_NOT_ALLOWED' : 'NO_SUBSCRIPTION',
    }],
    skipDuplicates: true,
  });
}

async function scanConnection(
  tx: Prisma.TransactionClient, stored: StoredPolicy, policy: EnvironmentPolicy,
  state: EnvironmentDeviceState, device: DeviceSnapshot, now: Date, availability: EnvironmentAvailability,
) {
  const changes = await tx.deviceStatusHistory.findMany({
    where: { deviceId: device.id, id: { gt: state.statusCursor }, detectedAt: { gt: state.startedAt, lte: now } },
    orderBy: { id: 'asc' }, take: 100,
  });
  for (const change of changes) {
    state.statusCursor = change.id;
    if (change.newStatus === 'offline') {
      state.offlineId = change.id;
      state.offlineAt = change.detectedAt;
      state.offlineQueued = false;
    } else if (change.newStatus === 'online' && state.offlineId !== null) {
      const outage = { policyId: stored.id, deviceId: device.id, kind: 'offline', sourceKey: String(state.offlineId) };
      await tx.environmentDelivery.updateMany({
        where: { ...outage, status: 'pending' },
        data: { status: 'skipped', lastErrorCode: 'CONNECTION_FLAPPED' },
      });
      const sent = await tx.environmentDelivery.findMany({
        where: { ...outage, status: { in: ['sent', 'sending'] } },
        select: { id: true, targetKey: true, subscriptionId: true },
      });
      const expires = new Date(change.detectedAt.getTime() + 48 * 60 * minute);
      if (sent.length && expires > now) {
        const event: Event = {
          kind: 'online', key: String(change.id), at: change.effectiveAt, expires,
          summary: `Thiết bị đã kết nối lại theo sự kiện ghi nhận lúc ${change.effectiveAt.toISOString()}.`,
        };
        await tx.environmentDelivery.createMany({
          data: sent.map(({ id, ...target }) => ({ ...deliveryData(stored, device, event, now), ...target, dependsOn: id })),
          skipDuplicates: true,
        });
      }
      state.offlineId = null;
      state.offlineAt = null;
      state.offlineQueued = false;
    }
  }
  const { wait_minutes, cooldown_minutes } = policy.connectivity;
  if (changes.length < 100 && state.offlineId !== null && state.offlineAt && !state.offlineQueued &&
    now.getTime() - state.offlineAt.getTime() >= wait_minutes * minute &&
    (!state.lastOfflineAt || now.getTime() - state.lastOfflineAt.getTime() >= cooldown_minutes * minute)) {
    await enqueue(tx, stored, device, {
      kind: 'offline', key: String(state.offlineId), at: state.offlineAt,
      expires: new Date(now.getTime() + 48 * 60 * minute),
      summary: `Thiết bị chưa kết nối lại kể từ lần mất kết nối ghi nhận lúc ${state.offlineAt.toISOString()}.`,
    }, availability, now);
    state.offlineQueued = true;
    state.lastOfflineAt = now;
  }
}

export async function scheduleEnvironment(db: Database, availability: EnvironmentAvailability, now = new Date()) {
  await db.environmentDelivery.updateMany({
    where: { status: 'pending', expiresAt: { lte: now } },
    data: { status: 'expired', lastErrorCode: 'DELIVERY_EXPIRED' },
  });
  const policies = await db.environmentPolicy.findMany({ select: { id: true, config: true } });
  const failures: unknown[] = [];
  for (const candidate of policies) {
    if (!environmentPolicyInput.parse(candidate.config).enabled) continue;
    await db.$transaction(async (tx) => {
      if (!(await lockEnvironmentPolicy(tx, candidate.id))) return;
      const stored = await tx.environmentPolicy.findUniqueOrThrow({
        where: { id: candidate.id }, include: { devices: true },
      });
      const policy = environmentPolicyInput.parse(stored.config);
      if (!policy.enabled) return;
      if (stored.userId && !(await tx.user.findFirst({ where: { id: stored.userId, active: true }, select: { id: true } }))) return;
      const devices = await tx.device.findMany({
        where: { id: { in: policy.device_ids }, archivedAt: null, ...(policy.include_simulators ? {} : { sourceKind: 'physical' }) },
        include: { roomAssignment: { include: { room: { include: { area: true } } } } },
      });
      for (const device of devices) {
        const state = stored.devices.find((s) => s.deviceId === device.id);
        if (!state) continue;
        const { policyId, deviceId, startedAt, ...progress } = state;
        if (policy.connectivity.enabled) await scanConnection(tx, stored, policy, state, device, now, availability);
        const slot = policy.digest.enabled && digestSlot(startedAt, now, policy.digest.interval_minutes);
        if (slot && (!state.lastDigestAt || slot > state.lastDigestAt)) {
          state.lastDigestAt = slot;
          if (now.getTime() - slot.getTime() <= 15 * minute) {
            const from = new Date(slot.getTime() - policy.digest.window_minutes * minute);
            const [m] = await sampleBuckets(tx, device, from, slot, false);
            const text = m && m.count >= 3
              ? `${m.count} mẫu hợp lệ. Nhiệt độ min/max/TB ${fixed(m.minTemp)}/${fixed(m.maxTemp)}/${fixed(m.temperature)} °C. Độ ẩm min/max/TB ${fixed(m.minHumidity)}/${fixed(m.maxHumidity)}/${fixed(m.humidity)} %RH.`
              : `Chưa đủ dữ liệu hợp lệ (${m?.count ?? 0}/3 mẫu tối thiểu).`;
            await enqueue(tx, stored, device, {
              kind: 'digest', key: slot.toISOString(), at: slot,
              expires: new Date(slot.getTime() + policy.digest.interval_minutes * minute),
              summary: `${from.toISOString()} → ${slot.toISOString()}. ${text}`,
            }, availability, now);
          }
        }
        // Use the newest window whose accepted arrival interval is over.
        const arrivalGrace = sampleFreshness(device);
        const ending = new Date(Math.floor((now.getTime() - arrivalGrace) / minute) * minute);
        if (policy.variation.enabled && ending > startedAt && (!state.variationChecked || ending > state.variationChecked)) {
          state.variationChecked = ending;
          if (!state.lastVariationAt || ending.getTime() - state.lastVariationAt.getTime() >= policy.variation.cooldown_minutes * minute) {
            const from = new Date(ending.getTime() - 2 * policy.variation.sustain_minutes * minute);
            const summary = variationSummary(await sampleBuckets(tx, device, from, ending, true), ending, policy.variation);
            if (summary) {
              await enqueue(tx, stored, device, {
                kind: 'variation', key: ending.toISOString(), at: ending,
                expires: new Date(ending.getTime() + arrivalGrace + policy.variation.sustain_minutes * minute), summary,
              }, availability, now);
              state.lastVariationAt = ending;
            }
          }
        }
        const changed = {
          lastDigestAt: state.lastDigestAt, variationChecked: state.variationChecked,
          lastVariationAt: state.lastVariationAt, statusCursor: state.statusCursor,
          offlineId: state.offlineId, offlineAt: state.offlineAt,
          offlineQueued: state.offlineQueued, lastOfflineAt: state.lastOfflineAt,
        };
        if (Object.keys(changed).some((key) => changed[key as keyof typeof changed] !== progress[key as keyof typeof progress])) {
          await tx.environmentDeviceState.update({ where: { policyId_deviceId: { policyId, deviceId } }, data: changed });
        }
      }
    }, { timeout: 30_000 }).catch((error: unknown) => { failures.push(error); });
  }
  if (failures.length) throw new AggregateError(failures, 'Environment scheduling failed for one or more policies.');
}

export function startEnvironmentScheduler(db: Database, availability: EnvironmentAvailability, onError: () => void) {
  let active: Promise<void> | undefined;
  const tick = () => {
    if (!active) active = scheduleEnvironment(db, availability).catch(onError).finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, 15_000);
  timer.unref();
  tick();
  return async () => { clearInterval(timer); await active; };
}
