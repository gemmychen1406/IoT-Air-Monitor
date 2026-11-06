import { z } from 'zod';

export const conditionSchema = z.enum(['gas', 'co', 'flame']);
export const severitySchema = z.enum(['warning', 'critical']);
const counter = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const deviceEventSchema = z.strictObject({
  event_id: z.uuid(),
  incident_id: z.uuid(),
  condition: conditionSchema,
  severity: severitySchema,
  transition: z.enum(['started', 'ended']),
  boot_id: z.uuid(),
  boot_counter: counter,
  seq: counter,
  occurred_at: z.iso.datetime().nullable(),
});
export const deviceEventsSchema = z.strictObject({
  schema_version: z.literal(1),
  device_id: z.uuid(),
  events: z.array(deviceEventSchema).min(1).max(50),
});
export type DeviceEvent = z.infer<typeof deviceEventSchema>;
export const patchDeviceSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    location: z.string().trim().max(160).optional(),
    description: z.string().trim().max(1000).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường cập nhật');
export const credentialSchema = z.strictObject({
  label: z.string().trim().max(80).default(''),
  expires_at: z.iso.datetime().nullable().optional(),
});
export const rotationSchema = credentialSchema.extend({
  overlap_minutes: z.number().int().min(1).max(1440).default(60),
});
export const deviceConfigSchema = z.strictObject({
  reporting_interval_ms: z.number().int().min(1000).max(60000),
});
export const updateConfigSchema = z.strictObject({
  expected_version: z.number().int().min(1),
  config: deviceConfigSchema,
});
export const configAckSchema = z.strictObject({
  version: z.number().int().min(1),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['applied', 'rejected']),
  reason: z.string().trim().max(500).default(''),
});
export const heartbeatSchema = z.strictObject({
  schema_version: z.literal(1),
  device_id: z.uuid(),
  boot_id: z.uuid(),
  boot_counter: counter,
  uptime_ms: counter,
  firmware_version: z.string().min(1).max(64),
});

const rangeFields = {
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  time_basis: z.enum(['sampled', 'received']).default('sampled'),
};
function validRange(v: { from?: string; to?: string }) {
  return (
    (!v.from && !v.to) ||
    (!!v.from &&
      !!v.to &&
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 90 * 86400000)
  );
}
export const historyQuerySchema = z
  .strictObject({
    ...rangeFields,
    limit: z.coerce.number().int().min(1).max(1000).default(120),
    cursor: counter.optional(),
  })
  .refine(validRange, 'Khoảng thời gian cần đủ from/to, tăng dần và tối đa 90 ngày');
export const exportQuerySchema = z
  .strictObject(rangeFields)
  .refine((v) => !!v.from && validRange(v), 'Export cần from/to hợp lệ, tối đa 90 ngày');
export const metricSchema = z.enum(['temperature_c', 'humidity_pct', 'mq2_adc', 'mq7_adc']);
export const analyticsQuerySchema = z
  .strictObject({
    ...rangeFields,
    metric: metricSchema.default('temperature_c'),
    bucket: z.enum(['minute', 'hour', 'day']).default('hour'),
    compare: z.literal('previous').optional(),
    adc_bits: z.coerce.number().int().min(8).max(16).optional(),
  })
  .refine((v) => !!v.from && validRange(v), 'Analytics cần from/to hợp lệ, tối đa 90 ngày')
  .refine((v) => {
    if (!v.from || !v.to) return true;
    return (
      Math.ceil(
        (Date.parse(v.to) - Date.parse(v.from)) /
          { minute: 60000, hour: 3600000, day: 86400000 }[v.bucket],
      ) <= 1999
    );
  }, 'Chọn bucket lớn hơn để không vượt 2000 điểm');
export const incidentQuerySchema = z
  .strictObject({
    device_id: z.uuid().optional(),
    condition: conditionSchema.optional(),
    severity: severitySchema.optional(),
    status: z.enum(['active', 'ended']).optional(),
    acknowledged: z.enum(['true', 'false']).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: counter.optional(),
  })
  .refine(validRange, 'Khoảng thời gian không hợp lệ');

export type Stats = {
  total_count: number;
  valid_count: number;
  invalid_count: number;
  min: number | null;
  max: number | null;
  average: number | null;
};
export type AnalyticsPeriod = {
  from: string;
  to: string;
  summary: Stats;
  series: (Stats & { bucket_start: string })[];
};
export type AnalyticsView = AnalyticsPeriod & {
  uses_rollups?: boolean;
  metric: z.infer<typeof metricSchema>;
  unit: string;
  time_basis: 'sampled' | 'received';
  adc_bits: number | null;
  source_kind: string;
  previous: AnalyticsPeriod | null;
};
export type IncidentView = {
  id: string;
  external_id: string | null;
  device_id: string;
  device_name: string;
  source_kind: string;
  condition: 'gas' | 'co' | 'flame';
  severity: 'warning' | 'critical';
  status: 'active' | 'ended';
  origin: string;
  started_at: string | null;
  ended_at: string | null;
  first_observed_at: string;
  acknowledgement: {
    acknowledged_at: string;
    note: string;
    user: { id: string; email: string };
  } | null;
};
export type EventView = {
  id: string;
  transition: string;
  occurred_at: string | null;
  received_at: string;
  boot_id: string;
  seq: string;
  source_event_id: string;
};
export type IncidentDetail = IncidentView & { events: EventView[] };
export type CredentialView = {
  key_id: string;
  label: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  replaces_key_id: string | null;
  status: 'active' | 'expired' | 'revoked';
};
export type ConfigVersionView = {
  version: number;
  config: z.infer<typeof deviceConfigSchema>;
  content_hash: string;
  created_at: string;
  author: string | null;
};
export type ConfigView = {
  desired: ConfigVersionView;
  applied_version: number | null;
  history: ConfigVersionView[];
  acknowledgements: { version: number; status: string; reason: string; received_at: string }[];
};
export type StatusView = {
  id: string;
  previous_status: string;
  new_status: string;
  effective_at: string;
  detected_at: string;
  reason: string;
};
