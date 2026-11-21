import { z } from 'zod';
import type { DeviceView } from './index.js';

export const spaceFields = {
  name: z.string().trim().min(1, 'Tên không được để trống.').max(80),
  description: z.string().trim().max(1000).default(''),
};
export const areaInput = z.strictObject(spaceFields);
export const roomInput = z.strictObject({ ...spaceFields, area_id: z.uuid() });
export const archiveInput = z.strictObject({ archived: z.boolean() });
export const assignmentInput = z.strictObject({ room_id: z.uuid().nullable(), only_unassigned: z.boolean().optional(), expected_room_id:z.uuid().optional() });
export const roomPositionInput = z.strictObject({
  room_id: z.uuid(),
  layout_version: z.number().int().nonnegative().optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export const mapThresholdInput = z.strictObject({
  temperature_c: z.number().min(-40).max(125),
  humidity_pct: z.number().min(0).max(100),
});
export type RoomPosition = Pick<z.infer<typeof roomPositionInput>, 'x' | 'y'>;
export type MapThresholds = z.infer<typeof mapThresholdInput>;
export type RoomMapDevice = DeviceView & {
  position: RoomPosition | null;
  open_incidents: { id: string; condition: string; severity: string }[];
};
export type RoomMapView = {
  thresholds: MapThresholds;
  rooms: { layout_version: number; id: string; name: string; archived_at: string | null; devices: RoomMapDevice[] }[];
};

export type AreaView = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export type RoomView = AreaView & { area_id: string };
export type SpacesView = {
  areas: AreaView[];
  rooms: RoomView[];
  devices: {
    id: string;
    name: string;
    location: string;
    archived_at: string | null;
    room_id: string | null;
  }[];
};
