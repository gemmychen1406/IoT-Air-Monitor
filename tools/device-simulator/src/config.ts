import { createHash } from 'node:crypto';
import { z } from 'zod';
import { deviceConfigSchema } from '@iot/contracts';

export type SimulatorConfig = { version: number; intervalMs: number; etag?: string };

export async function syncSimulatorConfig(
  url: URL,
  key: string,
  current: SimulatorConfig,
): Promise<SimulatorConfig> {
  const headers = { Authorization: `DeviceKey ${key}` };
  const response = await fetch(new URL('/api/v1/device/config', url), {
    headers: { ...headers, ...(current.etag ? { 'If-None-Match': current.etag } : {}) },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 304) return current;
  if (!response.ok) throw new Error(`Config HTTP ${response.status}`);
  const { data } = z
    .object({
      data: z.object({
        version: z.number().int().positive(),
        config: deviceConfigSchema,
        content_hash: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    })
    .parse(await response.json());
  const hash = createHash('sha256').update(JSON.stringify(data.config)).digest('hex');
  if (hash !== data.content_hash) throw new Error('Hash cấu hình không khớp.');
  if (data.version < current.version) throw new Error('Không tự hạ version cấu hình.');
  const ack = await fetch(new URL('/api/v1/device/config/ack', url), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: data.version, content_hash: hash, status: 'applied' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!ack.ok) throw new Error(`Config ACK HTTP ${ack.status}`);
  // Cache the ETag only after ACK, so a failed ACK is retried on the next poll.
  const etag = response.headers.get('etag');
  return {
    version: data.version,
    intervalMs: data.config.reporting_interval_ms,
    ...(etag ? { etag } : {}),
  };
}
