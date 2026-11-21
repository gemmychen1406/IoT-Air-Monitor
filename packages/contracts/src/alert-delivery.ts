import { z } from 'zod';

export const deliveryChannels = ['telegram', 'webpush'] as const;
export const deliveryStatuses = ['pending', 'sending', 'sent', 'failed', 'expired', 'skipped'] as const;

export const pushPreferenceInput = z.strictObject({ show_details: z.boolean() });
export type PushPreferenceView = z.infer<typeof pushPreferenceInput>;

export type ReceiptView = { received_at: string; source: 'web'; late: boolean };
export type IncidentReceiptsView = {
  eligible: boolean;
  mine: ReceiptView | null;
  team?: { user_id: string; email: string; receipt: ReceiptView }[];
};

export type DeliveryHistoryView = {
  id: string;
  target_id?: string | null;
  round?: number;
  incident_id: string;
  condition: 'gas' | 'co' | 'flame';
  channel: (typeof deliveryChannels)[number];
  severity: string;
  status: (typeof deliveryStatuses)[number];
  simulator: boolean;
  ended: boolean;
  device_name: string;
  location: string | null;
  location_source: 'assignment' | 'device_location' | 'none' | 'legacy';
  created_at: string;
  next_attempt_at: string;
  accepted_at: string | null;
  last_error_code: string | null;
  attempt_count: number;
  attempts: {
    number: number;
    outcome: string;
    started_at: string;
    finished_at: string | null;
    error_code: string | null;
  }[];
  my_receipt: ReceiptView | null;
};
