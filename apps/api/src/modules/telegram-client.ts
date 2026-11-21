export type TelegramConfig = { token: string; chatId: string; includeSimulators: boolean };
export type TelegramResult =
  { ok: true } | { ok: false; retryable: boolean; code: string; retryAfterSeconds?: number };
export async function sendTelegram(
  config: TelegramConfig,
  text: string,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
  incidentLink?: string | null,
): Promise<TelegramResult> {
  try {
    const linked = incidentLink && text.endsWith('\n' + incidentLink);
    const prefix = linked ? text.slice(0, -incidentLink.length) : '';
    const label = 'Xem sự cố';
    const response = await request(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: linked ? prefix + label : text,
        ...(linked
          ? {
              entities: [
                {
                  type: 'text_link',
                  offset: prefix.length,
                  length: label.length,
                  url: incidentLink,
                },
              ],
            }
          : {}),
        link_preview_options: { is_disabled: true },
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
    const body: unknown = await response.json().catch(() => null);
    const data = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const result =
      typeof data.result === 'object' && data.result !== null
        ? (data.result as Record<string, unknown>)
        : {};
    if (response.ok && data.ok === true && Number.isInteger(result.message_id)) return { ok: true };
    const status =
      Number.isInteger(data.error_code) &&
      Number(data.error_code) >= 400 &&
      Number(data.error_code) < 600
        ? Number(data.error_code)
        : response.status;
    if (status === 429) {
      const params =
        typeof data.parameters === 'object' && data.parameters !== null
          ? (data.parameters as Record<string, unknown>)
          : {};
      const retry =
        Number.isInteger(params.retry_after) && Number(params.retry_after) > 0
          ? Math.min(Number(params.retry_after), 86400)
          : 30;
      return {
        ok: false,
        retryable: true,
        code: 'TELEGRAM_RATE_LIMITED',
        retryAfterSeconds: retry,
      };
    }
    if (status >= 400 && status < 500)
      return { ok: false, retryable: status === 408, code: `TELEGRAM_HTTP_${status}` };
    return {
      ok: false,
      retryable: true,
      code: status >= 500 ? `TELEGRAM_HTTP_${status}` : 'TELEGRAM_RESPONSE_INVALID',
    };
  } catch {
    // Telegram URLs contain the bot token. Never return/log the original error,
    // URL, response description, chat ID or request body.
    return { ok: false, retryable: true, code: 'TELEGRAM_NETWORK_ERROR' };
  }
}
