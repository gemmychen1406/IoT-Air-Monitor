import argon2 from 'argon2';
import { z } from 'zod';
import { createDatabase } from '@iot/database';

const input = z
  .object({
    DATABASE_URL: z.string().min(1),
    ADMIN_EMAIL: z.email().transform((v) => v.toLowerCase()),
    ADMIN_PASSWORD: z.string().min(12).max(128),
  })
  .parse(process.env);
const db = createDatabase(input.DATABASE_URL);
try {
  const exists = await db.user.findUnique({ where: { email: input.ADMIN_EMAIL } });
  if (exists) throw new Error('Tài khoản đã tồn tại. Không tự ghi đè password hoặc role.');
  await db.user.create({
    data: {
      email: input.ADMIN_EMAIL,
      passwordHash: await argon2.hash(input.ADMIN_PASSWORD),
      role: 'admin',
    },
  });
  console.log('Đã tạo admin. Xóa ADMIN_PASSWORD khỏi .env sau khi bootstrap.');
} finally {
  await db.$disconnect();
}
