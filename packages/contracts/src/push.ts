import { z } from 'zod';

export const pushEndpointSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.hash &&
      (!u.port || u.port === '443') &&
      ((!u.search &&
        u.hostname === 'fcm.googleapis.com' &&
        /^\/(fcm\/send|wp)\/.+/.test(u.pathname)) ||
        (!u.search &&
          u.hostname === 'updates.push.services.mozilla.com' &&
          /^\/wpush\/v[12]\/.+/.test(u.pathname)) ||
        (!u.search && u.hostname === 'web.push.apple.com' && u.pathname.length > 2) ||
        (/^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname) &&
          u.pathname === '/w/' &&
          !!u.searchParams.get('token') &&
          [...u.searchParams.keys()].every((key) => key === 'token')))
    );
  }, 'Chỉ hỗ trợ endpoint Web Push HTTPS của Chrome/Edge, Firefox hoặc Safari.')
  .transform((value) => new URL(value).toString());
export const pushSubscriptionSchema = z.strictObject({
  endpoint: pushEndpointSchema,
  expirationTime: z.number().nonnegative().nullable().optional(),
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/),
  }),
});
export const registerPushSchema = z.strictObject({
  subscription: pushSubscriptionSchema,
  application_server_key: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  include_simulators: z.boolean().default(false),
});
export type PushConfigView = { enabled: boolean; public_key: string | null; session_bound: true };
export type PushSubscriptionView = {
  id: string;
  endpoint_hash: string;
  include_simulators: boolean;
  vapid_public_key: string;
  expires_at: string;
};
