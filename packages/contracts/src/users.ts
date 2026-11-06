import { z } from 'zod';
export const emailSchema = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(12).max(128);
export const roleSchema = z.enum(['admin', 'operator', 'viewer']);
export const createUserSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  role: roleSchema.default('viewer'),
});
export const updateUserSchema = z
  .strictObject({
    role: roleSchema.optional(),
    active: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const changePasswordSchema = z.strictObject({
  current_password: z.string().min(1).max(128),
  new_password: passwordSchema,
});
export const changeEmailSchema = z.strictObject({
  email: emailSchema,
  current_password: z.string().min(1).max(128),
});
export type AccountView = {
  id: string;
  email: string;
  role: z.infer<typeof roleSchema>;
  active: boolean;
  created_at: string;
};
export type AuditView = {
  id: string;
  action: string;
  user: { id: string; email: string } | null;
  resource_type: string;
  resource_id: string | null;
  device_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
