import type { Database } from '@iot/database';
import type { Telemetry, Reading, ReadingView, DeviceView } from '@iot/contracts';
import type { SensorReading } from '@prisma/client';
import { hashSecret } from './auth.js';
import { ApiError } from '../lib/errors.js';
import { markSeen } from './presence.js';
import { applySnapshot } from './alerts.js';
import type { AlertNotifier } from './notifications.js';

export function readingView(row: SensorReading): ReadingView {
  return {
    id: row.id.toString(),
    received_at: row.receivedAt.toISOString(),
    payload: row.payload as unknown as Reading,
  };
}

export async function listDevices(
  db: Database,
  archived = 'false',
  id?: string,
): Promise<DeviceView[]> {
  const devices = await db.device.findMany({
    where: {
      ...(id
        ? { id }
        : archived === 'all'
          ? {}
          : { archivedAt: archived === 'true' ? { not: null } : null }),
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  const ids = devices.flatMap((d) => (d.latestId === null ? [] : [d.latestId]));
  const readings = await db.sensorReading.findMany({ where: { id: { in: ids } } });
  const byId = new Map(readings.map((r) => [r.id, r]));
  return devices.map((d) => {
    const latest = d.latestId === null ? undefined : byId.get(d.latestId);
    return {
      id: d.id,
      name: d.name,
      source_kind: d.sourceKind,
      location: d.location,
      description: d.description,
      archived_at: d.archivedAt?.toISOString() ?? null,
      reporting_interval_ms: d.reportingIntervalMs,
      last_seen_at: d.lastSeenAt?.toISOString() ?? null,
      status: !d.lastSeenAt
        ? 'never_seen'
        : !d.archivedAt &&
            d.connectivity !== 'offline' &&
            Date.now() - d.lastSeenAt.getTime() < Math.max(30000, d.reportingIntervalMs * 3)
          ? 'online'
          : 'offline',
      latest: latest ? readingView(latest) : null,
    };
  });
}

export async function ingest(
  db: Database,
  keyId: string,
  input: Telemetry,
  notify?: AlertNotifier,
) {
  const now = new Date();
  const transmission = input.transmission;
  const currentCounter = BigInt(transmission.current_boot_counter);
  for (const r of input.readings) {
    if (
      BigInt(r.boot_counter) > currentCounter ||
      (r.boot_counter === transmission.current_boot_counter &&
        r.boot_id !== transmission.current_boot_id)
    )
      throw new ApiError(422, 'INVALID_BOOT', 'Boot identity không khớp transmission.');
    if (
      r.boot_id === transmission.current_boot_id &&
      BigInt(r.uptime_ms) > BigInt(transmission.sent_uptime_ms)
    )
      throw new ApiError(422, 'INVALID_UPTIME', 'Mẫu có uptime sau thời điểm gửi.');
    if (r.sampled_at) {
      const age = now.getTime() - Date.parse(r.sampled_at);
      if (age < -60000 || age > 86400000)
        throw new ApiError(
          422,
          'INVALID_SAMPLE_TIME',
          'Mẫu phải nằm trong cửa sổ 24 giờ và không ở tương lai.',
        );
    } else if (
      r.boot_id !== transmission.current_boot_id ||
      BigInt(transmission.sent_uptime_ms) - BigInt(r.uptime_ms) > 86400000n
    ) {
      throw new ApiError(
        422,
        'UNKNOWN_SAMPLE_AGE',
        'Không xác định được tuổi mẫu chưa đồng bộ giờ.',
      );
    }
  }
  return db.$transaction(async (tx) => {
    // Serialize writes per device: dedup, reboot order and snapshot update are atomic.
    await tx.$queryRaw`SELECT id FROM devices WHERE id = ${input.device_id}::uuid FOR UPDATE`;
    const credential = await tx.deviceCredential.findUnique({ where: { keyId } });
    if (
      !credential ||
      credential.revokedAt ||
      (credential.expiresAt && credential.expiresAt <= now)
    )
      throw new ApiError(401, 'INVALID_DEVICE_KEY', 'Key đã bị thu hồi.');
    const device = await tx.device.findUniqueOrThrow({ where: { id: input.device_id } });
    if (device.archivedAt) throw new ApiError(403, 'DEVICE_ARCHIVED', 'Thiết bị đang lưu trữ.');
    let latestId = device.latestId;
    let bootCounter = device.bootCounter;
    let bootId = device.bootId;
    let latestSeq = device.latestSeq;
    if (
      bootCounter !== null &&
      currentCounter === bootCounter &&
      bootId !== transmission.current_boot_id
    )
      throw new ApiError(
        409,
        'BOOT_CONFLICT',
        'Boot counter bị tái sử dụng. Cần kiểm tra provisioning.',
      );
    if (bootCounter === null || currentCounter > bootCounter) {
      bootCounter = currentCounter;
      bootId = transmission.current_boot_id;
      latestSeq = null;
      latestId = null;
    }
    const accepted: { boot_id: string; seq: string; duplicate: boolean }[] = [];
    const created: ReadingView[] = [];
    let eventsChanged = false;
    for (const record of input.readings) {
      const where = {
        deviceId_bootId_seq: {
          deviceId: input.device_id,
          bootId: record.boot_id,
          seq: BigInt(record.seq),
        },
      };
      const existing = await tx.sensorReading.findUnique({ where });
      const payloadHash = hashSecret(JSON.stringify(record));
      if (existing && existing.payloadHash !== payloadHash)
        throw new ApiError(409, 'IDENTITY_CONFLICT', 'Cùng định danh mẫu nhưng nội dung khác.');
      const row =
        existing ??
        (await tx.sensorReading.create({
          data: {
            deviceId: input.device_id,
            bootId: record.boot_id,
            bootCounter: BigInt(record.boot_counter),
            seq: BigInt(record.seq),
            sampledAt: record.sampled_at,
            receivedAt: now,
            temperatureC: record.sensors.dht11.temperature_c,
            humidityPct: record.sensors.dht11.humidity_pct,
            mq2Adc: record.sensors.mq2.adc_raw,
            mq7Adc: record.sensors.mq7.adc_raw,
            flame: record.sensors.flame.detected,
            payload: record,
            payloadHash,
          },
        }));
      accepted.push({ boot_id: record.boot_id, seq: record.seq, duplicate: !!existing });
      if (!existing) created.push(readingView(row));
      if (
        BigInt(record.boot_counter) === bootCounter &&
        record.boot_id === bootId &&
        (latestSeq === null || BigInt(record.seq) > latestSeq)
      ) {
        latestSeq = BigInt(record.seq);
        latestId = row.id;
      }
    }
    // Evaluate new snapshots in sample order, never reception order. Existing
    // incident/state ordering prevents delayed samples from reopening incidents.
    for (const row of [...created].sort((a, b) => {
      const x = BigInt(a.payload.boot_counter) - BigInt(b.payload.boot_counter);
      const y = BigInt(a.payload.seq) - BigInt(b.payload.seq);
      return x < 0n ? -1 : x > 0n ? 1 : y < 0n ? -1 : y > 0n ? 1 : 0;
    })) {
      if (
        BigInt(row.payload.boot_counter) === bootCounter &&
        row.payload.boot_id === bootId &&
        (device.bootCounter === null ||
          BigInt(row.payload.boot_counter) > device.bootCounter ||
          (row.payload.boot_id === device.bootId &&
            (device.latestSeq === null || BigInt(row.payload.seq) > device.latestSeq)))
      )
        eventsChanged =
          (await applySnapshot(tx, device.id, row.payload, now, notify)) || eventsChanged;
    }
    await tx.device.update({
      where: { id: device.id },
      data: { lastSeenAt: now, latestId, bootCounter, bootId, latestSeq },
    });
    await markSeen(tx, device, now, keyId);
    return { accepted, created, eventsChanged };
  });
}
