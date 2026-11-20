import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { Database } from "@iot/database";
import type { Reading } from "@iot/contracts";
import { buildPayload } from "../device-simulator/src/payload.js";

export const DEMO_IDS = Array.from(
  { length: 6 },
  (_, i) => `ad000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
);
export async function seedDemo(db: Database, email: string, password: string) {
  const now = Date.now();
  const start = now - 3600000;
  const names = [
    "Cảm biến phòng khách",
    "Cảm biến phòng bếp",
    "Cảm biến phòng ngủ",
    "Cảm biến ban công",
    "Thiết bị chưa kết nối",
    "Cảm biến đang chuẩn bị",
  ];
  const locations = [
    "Phòng khách",
    "Phòng bếp",
    "Phòng ngủ",
    "Ban công",
    "Phòng làm việc",
    "Phòng kho",
  ];
  await db.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: await argon2.hash(password), role: "admin" },
  });
  for (const [index, id] of DEMO_IDS.entries()) {
    await db.device.upsert({
      where: { id },
      create: {
        id,
        name: names[index]!,
        sourceKind: "simulator",
        location: locations[index]!,
        reportingIntervalMs: 5000,
      },
      update: { latestId: null },
    });
    await db.sensorReading.deleteMany({ where: { deviceId: id } });
    await db.deviceStatusHistory.deleteMany({ where: { deviceId: id } });
    await db.deviceConfig.upsert({
      where: { deviceId_version: { deviceId: id, version: 1 } },
      update: {},
      create: {
        deviceId: id,
        version: 1,
        config: { reporting_interval_ms: 5000 },
        contentHash: "demo-local",
      },
    });
    if (index === 4) continue;
    const boots = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const data = [];
    for (let n = 0; n < 720; n++) {
      if (index === 3 && n > 600) break;
      // Deliberate gaps for the diagnostics demonstration.
      if (index === 1 && n >= 200 && n < 250) continue;
      const boot = index === 2 ? Math.min(3, Math.floor(n / 180)) : 0;
      const timestamp = start + n * 5000;
      const reading = buildPayload({
        deviceId: id,
        bootId: boots[boot]!,
        bootCounter: String(boot + 1),
        seq: String(n + 1),
        uptime: ((n % (index === 2 ? 180 : 720)) + 1) * 5000,
        now: new Date(timestamp),
        scenario: "normal",
      }).readings[0]!;
      reading.firmware_version =
        index === 2 && boot >= 2 ? "demo-1.1.0" : "demo-1.0.0";
      reading.sensors.mq2.adc_raw =
        700 + index * 600 + Math.round(Math.sin(n / 10) * 10);
      reading.sensors.mq7.adc_raw =
        500 + index * 450 + Math.round(Math.sin(n / 10) * 10);
      if (index === 1 && n >= 660)
        reading.sensors.dht11 = {
          temperature_c: null,
          humidity_pct: null,
          quality: "invalid",
          age_ms: 0,
        };
      if (index === 0 && n >= 300 && n < 550) {
        reading.sensors.dht11.temperature_c = 27;
        reading.sensors.dht11.humidity_pct = 60;
      }
      if (index === 1 && n >= 280 && n < 290)
        reading.sensors.dht11.temperature_c = 38;
      if (index === 2 && n >= 660) {
        reading.time_quality = "unsynced";
        reading.sampled_at = null;
      }
      if (index === 2 && n === 400)
        reading.sampled_at = new Date(timestamp - 60000).toISOString();
      if (index === 5) {
        reading.sensors.mq2 = {
          ...reading.sensors.mq2,
          quality: "warming_up",
          adc_raw: null,
          adc_pin_mv: null,
        };
        reading.sensors.mq7 = {
          ...reading.sensors.mq7,
          quality: "heating",
          adc_raw: null,
          adc_pin_mv: null,
        };
      }
      data.push({
        deviceId: id,
        bootId: reading.boot_id,
        bootCounter: BigInt(reading.boot_counter),
        seq: BigInt(reading.seq),
        sampledAt: reading.sampled_at,
        receivedAt: new Date(timestamp + 250),
        payload: reading,
        payloadHash: "demo-local",
        temperatureC: reading.sensors.dht11.temperature_c,
        humidityPct: reading.sensors.dht11.humidity_pct,
        mq2Adc: reading.sensors.mq2.adc_raw,
        mq7Adc: reading.sensors.mq7.adc_raw,
        flame: false,
      });
    }
    await db.sensorReading.createMany({ data });
    const latest = await db.sensorReading.findFirstOrThrow({
      where: { deviceId: id },
      orderBy: { id: "desc" },
    });
    await db.device.update({
      where: { id },
      data: {
        latestId: latest.id,
        bootId: latest.bootId,
        bootCounter: latest.bootCounter,
        latestSeq: latest.seq,
        lastSeenAt: latest.receivedAt,
        connectivity: index === 3 ? "offline" : "online",
      },
    });
    await db.deviceStatusHistory.createMany({
      data: [
        {
          deviceId: id,
          previousStatus: "never_seen",
          newStatus: "online",
          effectiveAt: new Date(start),
          reason: "demo_authenticated_contact",
        },
        ...(index === 1
          ? [
              {
                deviceId: id,
                previousStatus: "online",
                newStatus: "offline",
                effectiveAt: new Date(start + 1020000),
                reason: "demo_heartbeat_timeout",
              },
              {
                deviceId: id,
                previousStatus: "offline",
                newStatus: "online",
                effectiveAt: new Date(start + 1250000),
                reason: "demo_authenticated_contact",
              },
            ]
          : []),
        ...(index === 3
          ? [
              {
                deviceId: id,
                previousStatus: "online",
                newStatus: "offline",
                effectiveAt: new Date(start + 3030000),
                reason: "demo_heartbeat_timeout",
              },
            ]
          : []),
      ],
    });
  }
}

/** Keep online demo devices fresh without device keys, exclusively inside the isolated preview database. */
export async function tickDemo(db: Database) {
  for (const index of [0, 1, 2, 5]) {
    const deviceId = DEMO_IDS[index]!;
    await db.$transaction(async (tx) => {
      const device = await tx.device.findUniqueOrThrow({
        where: { id: deviceId },
      });
      const old = await tx.sensorReading.findUniqueOrThrow({
        where: { id: device.latestId! },
      });
      const reading = structuredClone(old.payload) as unknown as Reading;
      reading.seq = String(BigInt(reading.seq) + 1n);
      reading.uptime_ms = String(BigInt(reading.uptime_ms) + 5000n);
      if (reading.time_quality === "synced")
        reading.sampled_at = new Date().toISOString();
      const row = await tx.sensorReading.create({
        data: {
          deviceId,
          bootId: reading.boot_id,
          bootCounter: BigInt(reading.boot_counter),
          seq: BigInt(reading.seq),
          sampledAt: reading.sampled_at,
          payload: reading,
          payloadHash: "demo-local",
          temperatureC: reading.sensors.dht11.temperature_c,
          humidityPct: reading.sensors.dht11.humidity_pct,
          mq2Adc: reading.sensors.mq2.adc_raw,
          mq7Adc: reading.sensors.mq7.adc_raw,
          flame: false,
        },
      });
      await tx.device.update({
        where: { id: deviceId },
        data: {
          latestId: row.id,
          lastSeenAt: row.receivedAt,
          latestSeq: row.seq,
        },
      });
    });
  }
}
