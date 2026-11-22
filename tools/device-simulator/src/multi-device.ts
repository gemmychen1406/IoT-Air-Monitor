import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { createDatabase } from '@iot/database';
import type { Telemetry } from '@iot/contracts';

const db = createDatabase(process.env.DATABASE_URL!);

const DEVICE_CONFIGS = [
  {
    name: 'Trạm 1 - Khu Nhà Bếp',
    location: 'Tầng 1 - Bếp nấu',
    description: 'Giám sát khí gas LPG và nguy cơ bốc cháy trong khu vực bếp',
    baseTemp: 30.5,
    baseHumidity: 70,
    baseMq2: 1350,
    baseMq7: 820,
    dangerAtCycle: false,
  },
  {
    name: 'Trạm 2 - Hầm Để Xe',
    location: 'Tầng hầm B1',
    description: 'Giám sát khí thải CO từ xe máy, ô tô và khói tích tụ',
    baseTemp: 25.2,
    baseHumidity: 66,
    baseMq2: 880,
    baseMq7: 1550, // CO cao hơn do khí thải xe
    dangerAtCycle: false,
  },
  {
    name: 'Trạm 3 - Phòng Khách',
    location: 'Tầng 2 - Phòng sinh hoạt chung',
    description: 'Giám sát chất lượng không khí không gian sinh hoạt, nhiệt độ và độ ẩm',
    baseTemp: 26.8,
    baseHumidity: 58,
    baseMq2: 620, // Rất sạch
    baseMq7: 410,
    dangerAtCycle: false,
  },
  {
    name: 'Trạm 4 - Kho Gas Kỹ Thuật',
    location: 'Khu kỹ thuật ngoài trời',
    description: 'Khu vực bình gas công nghiệp - mô phỏng sự cố khẩn cấp định kỳ',
    baseTemp: 29.0,
    baseHumidity: 62,
    baseMq2: 1100,
    baseMq7: 750,
    dangerAtCycle: true, // Trạm này sẽ có chu kỳ báo động để phục vụ demo!
  },
];

console.log('--- KHỞI TẠO CÁC TRẠM CẢM BIẾN DEMO ---');

// 1. Đổi tên trạm 'Test' cũ thành 'Trạm 1 - Khu Nhà Bếp' nếu có
const existingTest = await db.device.findFirst({ where: { name: 'Test' } });
if (existingTest) {
  await db.device.update({
    where: { id: existingTest.id },
    data: {
      name: DEVICE_CONFIGS[0]!.name,
      location: DEVICE_CONFIGS[0]!.location,
      description: DEVICE_CONFIGS[0]!.description,
    },
  });
  console.log(`Đã cập nhật thiết bị Test cũ thành: ${DEVICE_CONFIGS[0]!.name}`);
}

// 2. Tìm hoặc tạo đủ 4 thiết bị và key
const activeDevices: {
  id: string;
  name: string;
  key: string;
  cfg: (typeof DEVICE_CONFIGS)[number];
  bootId: string;
  bootCounter: string;
  seq: bigint;
}[] = [];

for (const cfg of DEVICE_CONFIGS) {
  let dev = await db.device.findFirst({
    where: { name: cfg.name },
    include: { credentials: true },
  });

  if (!dev) {
    dev = await db.device.create({
      data: {
        name: cfg.name,
        sourceKind: 'simulator',
        location: cfg.location,
        description: cfg.description,
        reportingIntervalMs: 5000,
      },
      include: { credentials: true },
    });
    console.log(`Đã tạo trạm mới: ${cfg.name}`);
  }

  // Cấp key mới nếu chưa có key active
  let credential = dev.credentials.find((c) => !c.revokedAt);
  let fullKey: string;
  if (!credential) {
    const keyId = randomBytes(12).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const secretHash = createHash('sha256').update(secret).digest('hex');
    await db.deviceCredential.create({
      data: { deviceId: dev.id, keyId, secretHash },
    });
    fullKey = `${keyId}.${secret}`;
  } else {
    // Để an toàn, cấp một key mới xác thực luôn
    const keyId = randomBytes(12).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const secretHash = createHash('sha256').update(secret).digest('hex');
    await db.deviceCredential.create({
      data: { deviceId: dev.id, keyId, secretHash },
    });
    fullKey = `${keyId}.${secret}`;
  }

  activeDevices.push({
    id: dev.id,
    name: cfg.name,
    key: fullKey,
    cfg,
    bootId: randomUUID(),
    bootCounter: String(Date.now()),
    seq: 0n,
  });
}

// 3. Tự động gán 4 trạm vào các phòng tương ứng để hiển thị trọn vẹn ở tab Tổng quan & Khu vực
try {
  let area = await db.monitoringArea.findFirst({ where: { nameKey: 'nha_mau_airguard' } });
  if (!area) {
    area = await db.monitoringArea.create({
      data: {
        name: 'Nhà mẫu AirGuard',
        nameKey: 'nha_mau_airguard',
        description: 'Hệ thống giám sát vi khí hậu hộ gia đình',
        mapTemperatureC: 28,
      },
    });
  }

  const roomMap: Record<string, { name: string; key: string; x: number; y: number }> = {
    'Trạm 1 - Khu Nhà Bếp': { name: 'Khu Nhà Bếp', key: 'khu_nha_bep', x: 0.25, y: 0.3 },
    'Trạm 2 - Hầm Để Xe': { name: 'Hầm Để Xe', key: 'ham_de_xe', x: 0.5, y: 0.7 },
    'Trạm 3 - Phòng Khách': { name: 'Phòng Khách', key: 'phong_khach', x: 0.7, y: 0.3 },
    'Trạm 4 - Kho Gas Kỹ Thuật': { name: 'Kho Gas Kỹ Thuật', key: 'kho_gas', x: 0.85, y: 0.8 },
  };

  for (const dev of activeDevices) {
    const rConfig = roomMap[dev.name];
    if (rConfig) {
      let room = await db.monitoringRoom.findFirst({ where: { areaId: area.id, nameKey: rConfig.key } });
      if (!room) {
        room = await db.monitoringRoom.create({
          data: {
            areaId: area.id,
            name: rConfig.name,
            nameKey: rConfig.key,
            description: `Khu vực ${rConfig.name}`,
          },
        });
      }
      await db.deviceRoomAssignment.upsert({
        where: { deviceId: dev.id },
        create: { deviceId: dev.id, roomId: room.id, x: rConfig.x, y: rConfig.y },
        update: { roomId: room.id, x: rConfig.x, y: rConfig.y },
      });
    }
  }
} catch {
  // Bỏ qua nếu bảng chưa migrate
}

await db.$disconnect();

console.log(`\n SẴN SÀNG GIẢ LẬP ĐỒNG THỜI ${activeDevices.length} TRẠM CẢM BIẾN:`);
activeDevices.forEach((d, i) => console.log(`  [${i + 1}] ${d.name} (${d.cfg.location})`));
console.log('Chu kỳ gửi: mỗi 5 giây. Nhấn Ctrl+C để dừng.\n');

const started = performance.now();
const apiUrl = new URL('http://127.0.0.1:4000');

let running = true;
process.on('SIGINT', () => {
  running = false;
});
process.on('SIGTERM', () => {
  running = false;
});

function buildCustomPayload(
  dev: (typeof activeDevices)[number],
  uptime: number,
  now: Date,
): Telemetry {
  const seqNum = ++dev.seq;
  const wave = Math.sin(Number(seqNum % 100n) / 8);

  // Kịch bản nguy hiểm: nếu trạm bật dangerAtCycle, cứ mỗi chu kỳ 10 mẫu sẽ có 4 mẫu nguy hiểm
  const phase = Number((seqNum - 1n) % 10n) + 1;
  const isDanger = dev.cfg.dangerAtCycle && phase >= 4 && phase <= 7;

  const gas = (adc: number) => ({
    adc_raw: adc,
    adc_bits: 12,
    adc_pin_mv: Math.round(adc * 0.6),
    quality: 'uncalibrated' as const,
    age_ms: 0,
    concentration_ppm: null,
  });

  const mq2Val = isDanger
    ? Math.round(2850 + 200 * wave)
    : Math.round(dev.cfg.baseMq2 + 60 * wave);
  const mq7Val = isDanger
    ? Math.round(2400 + 150 * wave)
    : Math.round(dev.cfg.baseMq7 + 50 * wave);

  return {
    schema_version: 1,
    device_id: dev.id,
    transmission: {
      current_boot_id: dev.bootId,
      current_boot_counter: dev.bootCounter,
      sent_uptime_ms: String(uptime),
    },
    readings: [
      {
        boot_id: dev.bootId,
        boot_counter: dev.bootCounter,
        seq: String(seqNum),
        sampled_at: now.toISOString(),
        uptime_ms: String(uptime),
        time_quality: 'synced',
        firmware_version: 'simulator-multi-0.2.0',
        config_version: 1,
        sensors: {
          dht11: {
            temperature_c:
              Math.round((dev.cfg.baseTemp + wave * 0.8 + (isDanger ? 4 : 0)) * 10) / 10,
            humidity_pct: Math.round(dev.cfg.baseHumidity + 2 * wave),
            quality: 'valid',
            age_ms: 0,
          },
          mq2: gas(mq2Val),
          mq7: { ...gas(mq7Val), heater_control: 'unverified' },
          flame: { detected: isDanger, quality: 'valid', age_ms: 0 },
        },
        alert_snapshot: {
          gas: isDanger ? 'active' : 'normal',
          co: isDanger ? 'active' : 'normal',
          flame: isDanger ? 'active' : 'normal',
          buzzer_commanded_on: isDanger,
        },
      },
    ],
  };
}

while (running) {
  const now = new Date();
  const uptime = Math.floor(performance.now() - started);

  for (const dev of activeDevices) {
    const payload = buildCustomPayload(dev, uptime, now);
    try {
      const res = await fetch(new URL('/api/v1/device/telemetry', apiUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `DeviceKey ${dev.key}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const snap = payload.readings[0]!.alert_snapshot;
        const alertTag = snap.buzzer_commanded_on ? '🔥 [BÁO ĐỘNG]' : '✅ [Bình thường]';
        console.log(
          `[${now.toLocaleTimeString()}] ${dev.name.padEnd(25)} -> Temp=${payload.readings[0]!.sensors.dht11.temperature_c}°C, MQ2=${payload.readings[0]!.sensors.mq2.adc_raw}, MQ7=${payload.readings[0]!.sensors.mq7.adc_raw} ${alertTag}`,
        );
      } else {
        console.warn(`[${dev.name}] HTTP ${res.status}`);
      }
    } catch (e: any) {
      console.warn(`[${dev.name}] Gửi lỗi: ${e?.message ?? e}`);
    }
  }

  if (running) await setTimeout(5000);
}
