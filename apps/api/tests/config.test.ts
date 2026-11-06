import { expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import webpush from 'web-push';

it('rejects missing database configuration instead of silently using another database', () => {
  expect(() => parseConfig({})).toThrow();
});
it('keeps Web Push disabled unless a complete matching VAPID key pair and subject are configured', () => {
  const base = { DATABASE_URL: 'postgresql://localhost/iot' };
  expect(parseConfig(base)).toMatchObject({ webPush: undefined });
  expect(() => parseConfig({ ...base, WEB_PUSH_ENABLED: 'true' })).toThrow();
  const pair = webpush.generateVAPIDKeys();
  expect(
    parseConfig({
      ...base,
      WEB_PUSH_ENABLED: 'true',
      WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey,
      WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey,
      WEB_PUSH_VAPID_SUBJECT: 'mailto:admin@example.com',
    }),
  ).toMatchObject({ webPush: { publicKey: pair.publicKey, subject: 'mailto:admin@example.com' } });
  expect(() =>
    parseConfig({
      ...base,
      WEB_PUSH_ENABLED: 'true',
      WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey,
      WEB_PUSH_VAPID_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey,
      WEB_PUSH_VAPID_SUBJECT: 'mailto:admin@example.com',
    }),
  ).toThrow();
});
it('disables Telegram by default and requires complete explicit credentials when enabled', () => {
  const base = { DATABASE_URL: 'postgresql://localhost/iot' };
  expect(parseConfig(base)).toMatchObject({ telegram: undefined });
  expect(() => parseConfig({ ...base, TELEGRAM_ENABLED: 'true' })).toThrow();
  expect(() => parseConfig({ ...base, TELEGRAM_ENABLED: 'false-ish' })).toThrow();
  expect(
    parseConfig({
      ...base,
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '123456789:abcdefghijklmnopqrstuvwxyz_123456789',
      TELEGRAM_CHAT_ID: '-1001234567890',
      TELEGRAM_INCLUDE_SIMULATORS: 'true',
    }),
  ).toMatchObject({ telegram: { chatId: '-1001234567890', includeSimulators: true } });
});
it('binds loopback by default and accepts only an exact web origin', () => {
  const config = parseConfig({
    DATABASE_URL: 'postgresql://localhost/iot',
    WEB_ORIGIN: 'http://localhost:5173',
  });
  expect(config.host).toBe('127.0.0.1');
  expect(config.port).toBe(4000);
  expect(() =>
    parseConfig({ DATABASE_URL: 'postgresql://localhost/iot', WEB_ORIGIN: '*' }),
  ).toThrow();
});

it('binds to all interfaces on cloud production while keeping strict origin checking', () => {
  const config = parseConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/iot',
    WEB_ORIGIN: 'https://airguard-demo.vercel.app',
  });
  expect(config.host).toBe('0.0.0.0');
  expect(config.origin).toBe('https://airguard-demo.vercel.app');
  expect(() =>
    parseConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/iot',
      WEB_ORIGIN: 'https://airguard-demo.vercel.app/',
    }),
  ).toThrow();
});
