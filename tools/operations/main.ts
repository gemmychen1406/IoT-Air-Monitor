import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createDatabase } from '@iot/database';
import { runMaintenance } from '../../apps/api/src/modules/maintenance.js';
import {
  backupDatabase,
  restoreDatabase,
  requireRecentBackup,
  databaseFingerprint,
} from './backup.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: 'string' },
    backup: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'batch-size': { type: 'string' },
  },
});
const action = z.enum(['backup', 'restore', 'maintenance']).parse(positionals[0]);
const url = z.url().parse(process.env.DATABASE_URL);
try {
  if (action === 'backup') {
    const file = z.string().min(1).parse(values.file);
    await backupDatabase(url, file, z.string().min(20).parse(process.env.BACKUP_PASSPHRASE));
    console.log(
      `Đã tạo backup mã hóa: ${file}. Lưu passphrase riêng, không commit backup hoặc passphrase.`,
    );
  } else if (action === 'restore') {
    const target = z.url().parse(process.env.RESTORE_DATABASE_URL);
    if (databaseFingerprint(target) === databaseFingerprint(url))
      throw new Error('Không restore vào database nguồn.');
    await restoreDatabase(
      target,
      z.string().min(1).parse(values.file),
      z.string().min(20).parse(process.env.BACKUP_PASSPHRASE),
    );
    console.log('Đã restore vào database riêng và thu hồi các web sessions được khôi phục.');
  } else {
    if (values.apply)
      await requireRecentBackup(
        z.string().min(1).parse(values.backup),
        z.string().min(20).parse(process.env.BACKUP_PASSPHRASE),
        url,
      );
    const db = createDatabase(url);
    try {
      console.log(
        JSON.stringify(
          await runMaintenance(db, {
            apply: values.apply,
            batchSize: values['batch-size'] ? Number(values['batch-size']) : 1000,
          }),
        ),
      );
    } finally {
      await db.$disconnect();
    }
  }
} catch {
  console.error(
    'Thao tác thất bại. Kiểm tra tham số, Docker/PostgreSQL, file backup/passphrase và quyền truy cập. Không restore đè DB có dữ liệu; retention --apply cần backup hợp lệ cùng DB trong 24 giờ.',
  );
  process.exitCode = 1;
}
