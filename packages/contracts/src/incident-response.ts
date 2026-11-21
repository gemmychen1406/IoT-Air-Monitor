import { z } from 'zod';
import { spaceFields } from './monitoring-spaces.js';

export const canonicalPhone = /^\+[1-9][0-9]{6,14}$/;
const phoneInput = z.string().trim().max(40)
  .regex(/^\+?[0-9() .-]+$/, 'Chỉ nhập số điện thoại, có thể dùng dấu + ở đầu.')
  .transform((value) => value.replace(/[() .-]/g, ''))
  .transform((value) => /^0[1-9][0-9]{8}$/.test(value) ? '+84' + value.slice(1) : value)
  .pipe(z.string().regex(canonicalPhone, 'Nhập số quốc tế có dấu + hoặc số Việt Nam 10 chữ số.'));

export const contactScope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('global') }),
  z.strictObject({ kind: z.literal('area'), id: z.uuid() }),
  z.strictObject({ kind: z.literal('room'), id: z.uuid() }),
]);
export const contactInput = z.strictObject({
  ...spaceFields,
  role: z.string().trim().min(1).max(80),
  phone: phoneInput,
  priority: z.number().int().min(1).max(999).default(100),
  scope: contactScope,
});

export type ContactView = z.output<typeof contactInput> & {
  id: string;
  archived_at: string | null;
};
export type IncidentSupportView = {
  location: {
    source: 'assignment' | 'device_location' | 'none';
    area_name: string | null;
    room_name: string | null;
    description: string | null;
    archived: boolean;
  };
  contacts: ContactView[];
};
