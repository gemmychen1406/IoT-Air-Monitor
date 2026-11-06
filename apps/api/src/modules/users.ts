import type { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import type { Prisma, User } from '@prisma/client';
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  changeEmailSchema,
  counterSchema,
} from '@iot/contracts';
import type { FeatureContext } from '../lib/context.js';
import { ApiError } from '../lib/errors.js';
import { SESSION_COOKIE } from './auth.js';

const view = (u: User) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  active: u.active,
  created_at: u.createdAt.toISOString(),
});
async function userAudit(
  tx: Prisma.TransactionClient,
  actor: string,
  target: string,
  action: string,
  metadata: Prisma.InputJsonObject = {},
) {
  await tx.auditLog.create({
    data: { userId: actor, resourceType: 'user', resourceId: target, action, metadata },
  });
}
async function lockUser(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản.');
  return user;
}
async function revokeSessions(tx: Prisma.TransactionClient, id: string) {
  const sessions = await tx.session.findMany({ where: { userId: id }, select: { id: true } });
  await tx.session.deleteMany({ where: { userId: id } });
  return sessions.map((s) => s.id);
}
export function registerUsers(
  router: Router,
  { db, reply, admin }: FeatureContext,
  disconnect: (id: string) => void,
) {
  router.get('/users/me', async (_req, res) =>
    reply(
      res,
      view(
        await db.user.findUniqueOrThrow({ where: { id: res.locals.session.user.id as string } }),
      ),
    ),
  );
  router.put('/users/me/password', async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const id = res.locals.session.user.id as string;
    const hash = await argon2.hash(input.new_password);
    const sessions = await db.$transaction(async (tx) => {
      const current = await lockUser(tx, id);
      if (!current.active || !(await argon2.verify(current.passwordHash, input.current_password)))
        throw new ApiError(403, 'REAUTH_REQUIRED', 'Mật khẩu hiện tại không đúng.');
      await tx.user.update({ where: { id }, data: { passwordHash: hash } });
      await userAudit(tx, id, id, 'user.password_changed');
      return revokeSessions(tx, id);
    });
    sessions.forEach(disconnect);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });
  router.patch('/users/me', async (req, res) => {
    const input = changeEmailSchema.parse(req.body);
    const id = res.locals.session.user.id as string;
    const result = await db.$transaction(async (tx) => {
      const current = await lockUser(tx, id);
      if (!current.active || !(await argon2.verify(current.passwordHash, input.current_password)))
        throw new ApiError(403, 'REAUTH_REQUIRED', 'Mật khẩu hiện tại không đúng.');
      if (await tx.user.findFirst({ where: { email: input.email, id: { not: id } } }))
        throw new ApiError(409, 'EMAIL_EXISTS', 'Email đã được sử dụng.');
      const user = await tx.user.update({ where: { id }, data: { email: input.email } });
      await userAudit(tx, id, id, 'user.email_changed');
      return { user, sessions: await revokeSessions(tx, id) };
    });
    result.sessions.forEach(disconnect);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    reply(res, view(result.user));
  });
  router.get('/users', admin, async (req, res) => {
    const q = z
      .strictObject({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        cursor: z.uuid().optional(),
      })
      .parse(req.query);
    const rows = await db.user.findMany({
      where: q.cursor ? { id: { gt: q.cursor } } : {},
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    reply(res, page.map(view), { next_cursor: rows.length > q.limit ? page.at(-1)!.id : null });
  });
  router.post('/users', admin, async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const passwordHash = await argon2.hash(input.password);
    const user = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(73142)`;
      const acting = await tx.user.findUniqueOrThrow({
        where: { id: res.locals.session.user.id as string },
      });
      if (!acting.active || acting.role !== 'admin')
        throw new ApiError(403, 'FORBIDDEN', 'Quyền admin đã bị thu hồi.');
      if (await tx.user.findUnique({ where: { email: input.email } }))
        throw new ApiError(409, 'EMAIL_EXISTS', 'Email đã được sử dụng.');
      const row = await tx.user.create({
        data: { email: input.email, role: input.role, passwordHash },
      });
      await userAudit(tx, res.locals.session.user.id as string, row.id, 'user.created', {
        role: row.role,
      });
      return row;
    });
    res.status(201);
    reply(res, view(user));
  });
  router.patch('/users/:id', admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = updateUserSchema.parse(req.body);
    const actor = res.locals.session.user.id as string;
    if (id === actor && (input.active === false || (input.role && input.role !== 'admin')))
      throw new ApiError(
        409,
        'SELF_LOCKOUT',
        'Không được tự khóa hoặc hạ quyền tài khoản đang sử dụng.',
      );
    const passwordHash = input.password ? await argon2.hash(input.password) : undefined;
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(73142)`;
      const acting = await tx.user.findUniqueOrThrow({ where: { id: actor } });
      if (!acting.active || acting.role !== 'admin')
        throw new ApiError(403, 'FORBIDDEN', 'Quyền admin đã bị thu hồi.');
      const target = await lockUser(tx, id);
      if (
        target.role === 'admin' &&
        target.active &&
        (input.active === false || (input.role && input.role !== 'admin')) &&
        (await tx.user.count({ where: { role: 'admin', active: true } })) <= 1
      )
        throw new ApiError(409, 'LAST_ADMIN', 'Phải giữ ít nhất một admin hoạt động.');
      const user = await tx.user.update({
        where: { id },
        data: { role: input.role, active: input.active, passwordHash },
      });
      await userAudit(tx, actor, id, 'user.updated', {
        role: user.role,
        active: user.active,
        password_reset: !!passwordHash,
      });
      return { user, sessions: await revokeSessions(tx, id) };
    });
    result.sessions.forEach(disconnect);
    reply(res, view(result.user));
  });
  router.get('/audit-logs', admin, async (req, res) => {
    const q = z
      .strictObject({
        cursor: counterSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        resource_type: z.enum(['user', 'device', 'maintenance']).optional(),
        resource_id: z.string().max(100).optional(),
        device_id: z.uuid().optional(),
        action: z.string().max(100).optional(),
      })
      .parse(req.query);
    const rows = await db.auditLog.findMany({
      where: {
        resourceType: q.resource_type,
        resourceId: q.resource_id,
        deviceId: q.device_id,
        action: q.action,
        ...(q.cursor ? { id: { lt: BigInt(q.cursor) } } : {}),
      },
      include: { user: { select: { id: true, email: true } } },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    reply(
      res,
      page.map((a) => ({
        id: String(a.id),
        action: a.action,
        user: a.user,
        resource_type: a.resourceType,
        resource_id: a.resourceId ?? a.deviceId,
        device_id: a.deviceId,
        metadata: a.metadata,
        created_at: a.createdAt.toISOString(),
      })),
      { next_cursor: rows.length > q.limit ? String(page.at(-1)!.id) : null },
    );
  });
}
