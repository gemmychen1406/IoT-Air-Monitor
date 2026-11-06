import { Readable, Writable } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, unlink, stat, link } from 'node:fs/promises';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
} from 'node:crypto';
import { spawn } from 'node:child_process';
import { createDatabase } from '@iot/database';
import { z } from 'zod';

const headerSchema = z.strictObject({
  version: z.literal(1),
  created_at: z.iso.datetime(),
  database: z.string().regex(/^[a-f0-9]{64}$/),
  salt: z.string().regex(/^[a-f0-9]{32}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
});
export function databaseFingerprint(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return createHash('sha256')
    .update(`${url.hostname}:${url.port || '5432'}${url.pathname}:${url.username}`)
    .digest('hex');
}
const key = (passphrase: string, salt: string) =>
  scryptSync(z.string().min(20).max(1024).parse(passphrase), Buffer.from(salt, 'hex'), 32);

export async function encryptBackup(
  source: Readable,
  path: string,
  passphrase: string,
  databaseUrl: string,
): Promise<void> {
  const metadata = {
    version: 1,
    created_at: new Date().toISOString(),
    database: databaseFingerprint(databaseUrl),
    salt: randomBytes(16).toString('hex'),
    iv: randomBytes(12).toString('hex'),
  };
  const json = Buffer.from(JSON.stringify(metadata));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  const header = Buffer.concat([length, json]);
  const cipher = createCipheriv(
    'aes-256-gcm',
    key(passphrase, metadata.salt),
    Buffer.from(metadata.iv, 'hex'),
  );
  cipher.setAAD(header);
  const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
  let created = false;
  output.once('open', () => {
    created = true;
  });
  try {
    output.write(header);
    await pipeline(source, cipher, output, { end: false });
    output.end(cipher.getAuthTag());
    await finished(output);
  } catch (error) {
    output.destroy();
    if (created) await unlink(path).catch(() => {});
    throw error;
  }
}

async function backupStream(path: string, passphrase: string) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    const length = Buffer.alloc(4);
    if ((await file.read(length, 0, 4, 0)).bytesRead !== 4) throw new Error('Backup không đầy đủ.');
    const n = length.readUInt32BE();
    if (n > 4096 || n < 2 || size <= n + 20) throw new Error('Backup header không hợp lệ.');
    const bytes = Buffer.alloc(n);
    await file.read(bytes, 0, n, 4);
    const metadata = headerSchema.parse(JSON.parse(bytes.toString()));
    const tag = Buffer.alloc(16);
    await file.read(tag, 0, 16, size - 16);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(passphrase, metadata.salt),
      Buffer.from(metadata.iv, 'hex'),
    );
    decipher.setAAD(Buffer.concat([length, bytes]));
    decipher.setAuthTag(tag);
    return { metadata, source: createReadStream(path, { start: n + 4, end: size - 17 }), decipher };
  } finally {
    await file.close();
  }
}
export async function verifyBackup(path: string, passphrase: string) {
  const { metadata, source, decipher } = await backupStream(path, passphrase);
  await pipeline(
    source,
    decipher,
    new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  );
  return metadata;
}

function postgresTool(databaseUrl: string, command: 'pg_dump' | 'pg_restore') {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Cần PostgreSQL URL.');
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  const hostNetwork = local && process.platform === 'linux';
  const env = {
    ...process.env,
    PGHOST: local ? (hostNetwork ? '127.0.0.1' : 'host.docker.internal') : url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'prefer',
  };
  const child = spawn(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      ...(hostNetwork ? ['--network=host'] : ['--add-host=host.docker.internal:host-gateway']),
      ...['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE'].flatMap((v) => [
        '-e',
        v,
      ]),
      'postgres:17-alpine',
      command,
      ...(command === 'pg_dump'
        ? ['--format=custom', '--no-owner', '--no-acl']
        : [
            '--single-transaction',
            '--exit-on-error',
            '--no-owner',
            '--no-acl',
            '--dbname',
            env.PGDATABASE,
          ]),
    ],
    { env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  child.stderr.resume(); // Never propagate command output containing connection details/secrets.
  const complete = new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error(`Không chạy được ${command}; kiểm tra Docker.`)));
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} thất bại; kiểm tra PostgreSQL/Docker/quyền truy cập.`)),
    );
  });
  void complete.catch(() => {});
  return { child, complete };
}
export async function backupDatabase(databaseUrl: string, path: string, passphrase: string) {
  // Validate the key before starting the external command.
  z.string().min(20).max(1024).parse(passphrase);
  const { child, complete } = postgresTool(databaseUrl, 'pg_dump');
  child.stdin.end();
  const partial = `${path}.partial-${randomUUID()}`;
  const encrypted = encryptBackup(child.stdout, partial, passphrase, databaseUrl);
  try {
    await Promise.all([encrypted, complete]);
    const metadata = await verifyBackup(partial, passphrase);
    await link(partial, path); // Exclusive publication: never overwrite an existing backup.
    return metadata;
  } catch (error) {
    child.kill();
    await encrypted.catch(() => {});
    throw error;
  } finally {
    await unlink(partial).catch(() => {});
  }
}
export async function restoreDatabase(databaseUrl: string, path: string, passphrase: string) {
  await verifyBackup(path, passphrase); // Authenticate everything before pg_restore receives bytes.
  const db = createDatabase(databaseUrl);
  try {
    const [tables] = await db.$queryRaw<
      { n: number }[]
    >`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`;
    if (tables!.n > 0)
      throw new Error('Restore chỉ cho database trống; không ghi đè dữ liệu có sẵn.');
  } finally {
    await db.$disconnect();
  }
  const { source, decipher } = await backupStream(path, passphrase);
  const { child, complete } = postgresTool(databaseUrl, 'pg_restore');
  child.stdout.resume();
  try {
    await Promise.all([pipeline(source, decipher, child.stdin), complete]);
  } catch (error) {
    child.kill();
    throw error;
  }
  const restored = createDatabase(databaseUrl);
  try {
    await restored.session.deleteMany();
    const [outbox] = await restored.$queryRaw<
      { name: string | null }[]
    >`SELECT to_regclass('public.telegram_notifications')::text AS name`;
    if (outbox?.name)
      await restored.telegramNotification.updateMany({
        where: { status: { in: ['pending', 'sending'] } },
        data: {
          status: 'failed',
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: 'RESTORE_REVIEW_REQUIRED',
        },
      });
  } finally {
    await restored.$disconnect();
  }
}
export async function requireRecentBackup(path: string, passphrase: string, databaseUrl: string) {
  const metadata = await verifyBackup(path, passphrase);
  const age = Date.now() - Date.parse(metadata.created_at);
  if (
    metadata.database !== databaseFingerprint(databaseUrl) ||
    age < 0 ||
    age > 86400000 ||
    !(await stat(path)).isFile()
  )
    throw new Error(
      'Cần backup cùng database, hợp lệ và mới trong 24 giờ trước khi retention --apply.',
    );
}
