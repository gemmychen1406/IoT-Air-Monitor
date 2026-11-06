import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from '@iot/database';
import type { UserView } from '@iot/contracts';
import { ApiError } from '../lib/errors.js';

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');
export function matchesSecret(secret: string, expected: string) {
  const actual = Buffer.from(hashSecret(secret), 'hex');
  const stored = Buffer.from(expected, 'hex');
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}
export const SESSION_COOKIE = 'iot_session';
export function sessionCookieToken(cookie: string | undefined) {
  const value = cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
export async function authenticateUser(
  db: Database,
  authorization: string | undefined,
  cookie?: string,
) {
  // Explicit bearer credentials remain available for API clients; the web only uses HttpOnly cookies.
  const token = authorization
    ? authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
    : sessionCookieToken(cookie);
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập.');
  const session = await db.session.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active)
    throw new ApiError(401, 'UNAUTHORIZED', 'Phiên đã hết hạn hoặc bị thu hồi.');
  const user: UserView = {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
  };
  return { sessionId: session.id, user, expiresAt: session.expiresAt };
}
export async function authenticateDevice(db: Database, authorization: string | undefined) {
  const match = authorization?.match(/^DeviceKey ([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/);
  if (!match) throw new ApiError(401, 'INVALID_DEVICE_KEY', 'Credential thiết bị không hợp lệ.');
  const key = await db.deviceCredential.findUnique({
    where: { keyId: match[1] },
    include: { device: true },
  });
  if (
    !key ||
    key.revokedAt ||
    (key.expiresAt && key.expiresAt <= new Date()) ||
    !matchesSecret(match[2]!, key.secretHash)
  )
    throw new ApiError(401, 'INVALID_DEVICE_KEY', 'Credential thiết bị không hợp lệ.');
  if (key.device.archivedAt) throw new ApiError(403, 'DEVICE_ARCHIVED', 'Thiết bị đang lưu trữ.');
  return key;
}
