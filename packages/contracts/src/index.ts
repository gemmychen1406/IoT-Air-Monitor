import { z } from 'zod';

export const counterSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n, 'Counter exceeds PostgreSQL BIGINT');
const age = z.number().int().min(0).max(86_400_000);
export const qualitySchema = z.enum(['valid', 'invalid', 'warming_up', 'uncalibrated', 'heating']);
export const alertStateSchema = z.enum(['normal', 'active', 'unknown', 'not_configured']);
export const alertSnapshotSchema = z.strictObject({
  gas: alertStateSchema,
  co: alertStateSchema,
  flame: alertStateSchema,
  buzzer_commanded_on: z.boolean(),
  incident_ids: z
    .strictObject({ gas: z.uuid().optional(), co: z.uuid().optional(), flame: z.uuid().optional() })
    .optional(),
});
const gasSchema = z
  .strictObject({
    adc_raw: z.number().int().nonnegative().nullable(),
    adc_bits: z.number().int().min(8).max(16),
    adc_pin_mv: z.number().min(0).max(3300).nullable(),
    quality: qualitySchema,
    age_ms: age,
    // v1 raw profile deliberately does not accept calibrated concentration claims.
    concentration_ppm: z.null(),
  })
  .superRefine((value, ctx) => {
    if (value.adc_raw !== null && value.adc_raw >= 2 ** value.adc_bits)
      ctx.addIssue({ code: 'custom', message: 'ADC exceeds resolution', path: ['adc_raw'] });
    if (value.quality === 'invalid' && (value.adc_raw !== null || value.adc_pin_mv !== null))
      ctx.addIssue({ code: 'custom', message: 'Invalid sensor must use null values' });
    if (value.quality === 'valid' && value.adc_raw === null)
      ctx.addIssue({ code: 'custom', message: 'Valid gas signal requires ADC', path: ['adc_raw'] });
  });
const dhtSchema = z
  .strictObject({
    temperature_c: z.number().min(-40).max(125).nullable(),
    humidity_pct: z.number().min(0).max(100).nullable(),
    quality: z.enum(['valid', 'invalid', 'warming_up']),
    age_ms: age,
  })
  .superRefine((value, ctx) => {
    const missing = value.temperature_c === null || value.humidity_pct === null;
    if (
      (value.quality === 'valid' && missing) ||
      (value.quality !== 'valid' && !missing) ||
      (value.quality !== 'valid' && (value.temperature_c !== null || value.humidity_pct !== null))
    )
      ctx.addIssue({ code: 'custom', message: 'DHT quality and values disagree' });
  });
export const readingSchema = z
  .strictObject({
    boot_id: z.uuid(),
    boot_counter: counterSchema,
    seq: counterSchema,
    sampled_at: z.iso.datetime().nullable(),
    uptime_ms: counterSchema,
    time_quality: z.enum(['synced', 'unsynced']),
    firmware_version: z.string().min(1).max(64),
    config_version: z.number().int().min(1),
    sensors: z.strictObject({
      dht11: dhtSchema,
      mq2: gasSchema,
      mq7: gasSchema.safeExtend({
        heater_control: z.enum(['unverified', 'controlled', 'unsupported']),
      }),
      flame: z
        .strictObject({
          detected: z.boolean().nullable(),
          quality: z.enum(['valid', 'invalid']),
          age_ms: age,
        })
        .refine(
          (v) => (v.quality === 'valid') === (v.detected !== null),
          'Flame quality and value disagree',
        ),
    }),
    alert_snapshot: alertSnapshotSchema,
  })
  .refine(
    (value) => (value.time_quality === 'synced') === (value.sampled_at !== null),
    'Timestamp must agree with time_quality',
  );

export const telemetrySchema = z.strictObject({
  schema_version: z.literal(1),
  device_id: z.uuid(),
  transmission: z.strictObject({
    current_boot_id: z.uuid(),
    current_boot_counter: counterSchema,
    sent_uptime_ms: counterSchema,
  }),
  readings: z.array(readingSchema).min(1).max(20),
});

export const createDeviceSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  source_kind: z.enum(['physical', 'simulator']),
});
export const loginSchema = z.strictObject({
  email: z.email().transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});
export type Reading = z.infer<typeof readingSchema>;
export type Telemetry = z.infer<typeof telemetrySchema>;
export type AlertSnapshot = z.infer<typeof alertSnapshotSchema>;
export type Role = 'admin' | 'operator' | 'viewer';
export type UserView = { id: string; email: string; role: Role };
export type ReadingView = { id: string; received_at: string; payload: Reading };
export type DeviceView = {
  id: string;
  name: string;
  source_kind: 'physical' | 'simulator';
  last_seen_at: string | null;
  status: 'online' | 'offline' | 'never_seen';
  latest: ReadingView | null;
  location?: string;
  description?: string;
  archived_at?: string | null;
  reporting_interval_ms?: number;
};

export * from './features.js';
export * from './users.js';
export * from './push.js';
