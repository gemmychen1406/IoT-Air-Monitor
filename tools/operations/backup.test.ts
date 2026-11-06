import { it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encryptBackup, verifyBackup } from './backup.js';

it('authenticates encrypted backup contents and rejects wrong keys or tampering', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'iot-backup-test-'));
  try {
    const file = join(folder, 'backup.enc');
    const passphrase = 'test-only-secret-passphrase-123456';
    await encryptBackup(
      Readable.from(['sensitive database dump']),
      file,
      passphrase,
      'postgresql://user:hidden@localhost:15432/iot_monitor',
    );
    const verified = await verifyBackup(file, passphrase);
    expect(verified.created_at).toMatch(/^\d{4}-/);
    const contents = await readFile(file);
    expect(contents.toString()).not.toContain('sensitive database dump');
    expect(contents.toString()).not.toContain('hidden');
    await expect(verifyBackup(file, 'wrong-passphrase-that-is-long-enough')).rejects.toThrow();
    contents[contents.length - 20] = contents[contents.length - 20]! ^ 1;
    await writeFile(file, contents);
    await expect(verifyBackup(file, passphrase)).rejects.toThrow();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
