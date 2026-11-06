import { z } from 'zod';
import { createECDH } from 'node:crypto';

export function parseConfig(env: Record<string, string | undefined>) {
  const input = z
    .object({
      DATABASE_URL: z
        .string()
        .url()
        .refine((v) => /^postgres(ql)?:\/\//.test(v)),
      WEB_ORIGIN: z
        .url()
        .refine((v) => {
          const u = new URL(v);
          return ['http:', 'https:'].includes(u.protocol) && u.origin === v;
        })
        .default('http://localhost:5173'),
      HOST: z.string().default(env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
      PORT: z.coerce.number().int().min(1).max(65535).default(4000),
      LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
      TELEGRAM_ENABLED: z.enum(['true', 'false']).default('false'),
      TELEGRAM_BOT_TOKEN: z.string().optional(),
      TELEGRAM_CHAT_ID: z.string().optional(),
      TELEGRAM_INCLUDE_SIMULATORS: z.enum(['true', 'false']).default('false'),
      WEB_PUSH_ENABLED: z.enum(['true', 'false']).default('false'),
      WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
      WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
      WEB_PUSH_VAPID_SUBJECT: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      if (
        value.TELEGRAM_ENABLED === 'true' &&
        !/^\d{5,20}:[A-Za-z0-9_-]{30,100}$/.test(value.TELEGRAM_BOT_TOKEN ?? '')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_BOT_TOKEN'],
          message: 'Cần bot token Telegram hợp lệ khi bật thông báo.',
        });
      if (
        value.TELEGRAM_ENABLED === 'true' &&
        !/^-?[1-9]\d{0,19}$/.test(value.TELEGRAM_CHAT_ID ?? '')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_CHAT_ID'],
          message: 'Cần chat ID dạng số (âm cho group/supergroup).',
        });
      if (value.WEB_PUSH_ENABLED === 'true') {
        try {
          if (
            !/^[A-Za-z0-9_-]{43}$/.test(value.WEB_PUSH_VAPID_PRIVATE_KEY ?? '') ||
            !/^[A-Za-z0-9_-]{87}$/.test(value.WEB_PUSH_VAPID_PUBLIC_KEY ?? '')
          )
            throw new Error();
          const curve = createECDH('prime256v1');
          curve.setPrivateKey(Buffer.from(value.WEB_PUSH_VAPID_PRIVATE_KEY!, 'base64url'));
          if (curve.getPublicKey().toString('base64url') !== value.WEB_PUSH_VAPID_PUBLIC_KEY)
            throw new Error();
        } catch {
          ctx.addIssue({
            code: 'custom',
            path: ['WEB_PUSH_VAPID_PRIVATE_KEY'],
            message: 'Cần cặp khóa VAPID P-256 hợp lệ và khớp nhau. Chạy npm run webpush:keys.',
          });
        }
        const subject = value.WEB_PUSH_VAPID_SUBJECT ?? '';
        const valid = subject.startsWith('mailto:')
          ? z.email().safeParse(subject.slice(7)).success
          : z
              .url()
              .refine((v) => new URL(v).protocol === 'https:')
              .safeParse(subject).success;
        if (!valid)
          ctx.addIssue({
            code: 'custom',
            path: ['WEB_PUSH_VAPID_SUBJECT'],
            message: 'Cần mailto:email hoặc URL HTTPS liên hệ cho VAPID.',
          });
      }
    })
    .parse(env);
  return {
    databaseUrl: input.DATABASE_URL,
    origin: input.WEB_ORIGIN,
    host: input.HOST,
    port: input.PORT,
    logLevel: input.LOG_LEVEL,
    webPush:
      input.WEB_PUSH_ENABLED === 'true'
        ? {
            publicKey: input.WEB_PUSH_VAPID_PUBLIC_KEY!,
            privateKey: input.WEB_PUSH_VAPID_PRIVATE_KEY!,
            subject: input.WEB_PUSH_VAPID_SUBJECT!,
          }
        : undefined,
    telegram:
      input.TELEGRAM_ENABLED === 'true'
        ? {
            token: input.TELEGRAM_BOT_TOKEN!,
            chatId: input.TELEGRAM_CHAT_ID!,
            includeSimulators: input.TELEGRAM_INCLUDE_SIMULATORS === 'true',
          }
        : undefined,
  };
}
