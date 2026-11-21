import { z } from 'zod';
import { deliveryChannels, deliveryStatuses } from './alert-delivery.js';

export const environmentKinds = ['digest', 'variation', 'offline', 'online'] as const;
export const environmentKindLabels = {
  digest: 'Bản tin môi trường',
  variation: 'Biến động môi trường',
  offline: 'Mất kết nối',
  online: 'Kết nối lại',
};
export type EnvironmentKind = (typeof environmentKinds)[number];
export type EnvironmentChannel = (typeof deliveryChannels)[number];
export const digestIntervals = [5, 15, 30, 60, 180, 360, 720, 1440] as const;
const clockText = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const quiet = z.strictObject({ start: clockText, end: clockText })
  .refine((v) => v.start !== v.end, 'Giờ bắt đầu và kết thúc phải khác nhau.');
const timeZone = z.string().min(1).max(80).refine((value) => {
  if (!/^[A-Za-z]/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Múi giờ IANA không hợp lệ.');
const minutes = (min: number, max: number) => z.number().int().min(min).max(max);

export const environmentPolicyInput = z.strictObject({
  enabled: z.boolean(),
  device_ids: z.array(z.uuid()).max(20).refine((ids) => new Set(ids).size === ids.length),
  include_simulators: z.boolean(),
  timezone: timeZone,
  quiet: quiet.nullable(),
  quiet_incidents: z.boolean(),
  critical_bypass: z.boolean(),
  digest: z.strictObject({
    enabled: z.boolean(),
    interval_minutes: z.number().int().refine((x) => digestIntervals.some((v) => v === x)),
    window_minutes: minutes(5, 1440),
  }),
  variation: z.strictObject({
    enabled: z.boolean(),
    temperature_delta: z.number().min(0.1).max(30),
    humidity_delta: z.number().min(0.1).max(100),
    sustain_minutes: minutes(3, 30),
    cooldown_minutes: minutes(5, 1440),
  }),
  connectivity: z.strictObject({
    enabled: z.boolean(), wait_minutes: minutes(1, 60), cooldown_minutes: minutes(1, 1440),
  }),
}).refine((v) => !v.enabled || (!!v.device_ids.length &&
  (v.digest.enabled || v.variation.enabled || v.connectivity.enabled)),
'Chọn ít nhất một thiết bị và loại tin khi bật thông báo.');

export type EnvironmentPolicy = z.infer<typeof environmentPolicyInput>;
export const defaultEnvironmentPolicy: EnvironmentPolicy = {
  enabled: false, device_ids: [], include_simulators: false, timezone: 'Asia/Ho_Chi_Minh',
  quiet: null, quiet_incidents: false, critical_bypass: true,
  digest: { enabled: true, interval_minutes: 60, window_minutes: 60 },
  variation: { enabled: false, temperature_delta: 2, humidity_delta: 10, sustain_minutes: 5, cooldown_minutes: 30 },
  connectivity: { enabled: false, wait_minutes: 2, cooldown_minutes: 10 },
};
export type EnvironmentSettingsView = {
  policy: EnvironmentPolicy;
  channel_ready: boolean;
  simulator_allowed_by_server: boolean;
  next_digest_at: string | null;
};
export type EnvironmentAttempt = {
  number: number; started_at: string; finished_at: string | null;
  outcome: string; error_code: string | null;
};
export type EnvironmentHistoryView = {
  id: string; kind: EnvironmentKind; channel: EnvironmentChannel;
  status: (typeof deliveryStatuses)[number]; device_name: string; simulator: boolean;
  location: string | null; summary: string; occurred_at: string; created_at: string;
  next_attempt_at: string; accepted_at: string | null; last_error_code: string | null;
  attempts: EnvironmentAttempt[];
};
export type EnvironmentPushPayload = {
  version: 3; notification_id: string; kind: EnvironmentKind; simulator: boolean;
  url: '/app/notifications?view=environment'; details?: { summary: string };
};
