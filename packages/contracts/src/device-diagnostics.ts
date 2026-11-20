import { z } from "zod";
import type { ReadingView } from "./index.js";

export const diagnosticOptionsSchema = z.object({
  gap_multiplier: z.coerce.number().min(2).max(20).default(3),
  flat_minutes: z.coerce.number().min(5).max(120).default(15),
  temperature_jump: z.coerce.number().min(1).max(30).default(5),
  humidity_jump: z.coerce.number().min(2).max(80).default(15),
  gas_jump_pct: z.coerce.number().min(5).max(90).default(25),
  reboot_threshold: z.coerce.number().int().min(2).max(20).default(3),
});
export const diagnosticQuerySchema = diagnosticOptionsSchema
  .extend({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 14 * 86400000,
    "Chọn khoảng tăng dần, tối đa 14 ngày.",
  );
export type DiagnosticOptions = z.infer<typeof diagnosticOptionsSchema>;
export type DiagnosticQuery = z.infer<typeof diagnosticQuerySchema>;
export type DiagnosticStatus = { effective_at: string; status: string };
export type DiagnosticInput = {
  readings: ReadingView[];
  statuses: DiagnosticStatus[];
  baseline: DiagnosticStatus | null;
  intervals: Record<number, number>;
  interval_ms: number;
  created_at?: string;
};
export type DiagnosticNotice = {
  id: string;
  level: "check" | "info";
  title: string;
  evidence: string;
  action: string;
};
export type DiagnosticEvent = {
  kind: "gap" | "flat" | "jump" | "clock";
  sensor: string;
  from: string;
  to: string;
  detail: string;
};
export type DiagnosticReport = {
  from: string;
  to: string;
  generated_at: string;
  source_kind: string;
  count: number;
  completeness: {
    truncated: boolean;
    rolled_up: boolean;
    status_truncated: boolean;
    config_truncated: boolean;
    first_received_at: string | null;
    last_received_at: string | null;
  };
  quality: {
    sensor: string;
    counts: Record<string, number>;
    total: number;
    stale: number;
  }[];
  events: DiagnosticEvent[];
  event_count: number;
  connection: {
    offline_ms: number;
    unknown_ms: number;
    disconnects: number;
    interval_median_ms: number | null;
    delay_median_ms: number | null;
    delay_p95_ms: number | null;
    delay_count: number;
  };
  clock: {
    synced: number;
    unsynced: number;
    backwards: number;
    future: number;
  };
  sessions: {
    boot_id: string;
    boot_counter: string;
    first_at: string;
    last_at: string;
    samples: number;
    firmware: string[];
  }[];
  firmware_changes: { at: string; previous: string; current: string }[];
  session_count: number;
  firmware_change_count: number;
  reboots_observed: number;
  notices: DiagnosticNotice[];
};
