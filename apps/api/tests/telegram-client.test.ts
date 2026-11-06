import { expect, it } from 'vitest';
import { sendTelegram } from '../src/modules/telegram-client.js';

const config = {
  token: '123456789:abcdefghijklmnopqrstuvwxyz_123456789',
  chatId: '-1001234567890',
  includeSimulators: true,
};
it('sends plain text to the fixed Telegram API without enabling markup or link previews', async () => {
  let sent: { url: string; body: Record<string, unknown> } | undefined;
  const result = await sendTelegram(config, '<device & simulation>', async (url, init) => {
    sent = { url: String(url), body: JSON.parse(String(init?.body)) };
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeDefined();
    return new Response(JSON.stringify({ ok: true, result: { message_id: 123 } }), { status: 200 });
  });
  expect(result).toEqual({ ok: true });
  expect(sent?.url).toBe(`https://api.telegram.org/bot${config.token}/sendMessage`);
  expect(sent?.body).toMatchObject({
    chat_id: config.chatId,
    text: '<device & simulation>',
    link_preview_options: { is_disabled: true },
  });
  expect(sent?.body).not.toHaveProperty('parse_mode');
});
it('honors Telegram retry_after but treats invalid/blocked credentials as permanent failures', async () => {
  const limited = await sendTelegram(
    config,
    'test',
    async () =>
      new Response(
        JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 30 } }),
        { status: 429 },
      ),
  );
  expect(limited).toMatchObject({ ok: false, retryable: true, retryAfterSeconds: 30 });
  const denied = await sendTelegram(
    config,
    'test',
    async () =>
      new Response(
        JSON.stringify({ ok: false, error_code: 403, description: `private ${config.token}` }),
        { status: 403 },
      ),
  );
  expect(denied).toMatchObject({ ok: false, retryable: false });
  expect(JSON.stringify(denied)).not.toContain(config.token);
});
it('never exposes token-bearing URLs or response bodies from network errors', async () => {
  const result = await sendTelegram(config, 'test', async () => {
    throw new Error(`fetch failed https://api.telegram.org/bot${config.token}`);
  });
  expect(result).toMatchObject({ ok: false, retryable: true });
  expect(JSON.stringify(result)).not.toContain(config.token);
});
