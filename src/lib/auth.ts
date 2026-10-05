import { and, count, eq, gte, sql } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '@/db';
import { authAttempts, sessions, users, type User } from '@/db/schema';
import { SESSION_COOKIE } from './auth-cookie';
import { hashToken, newSessionToken, verifyKey } from './auth-key';

export { SESSION_COOKIE };

const ONE_YEAR = 60 * 60 * 24 * 365;
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_NAME = 8; // per 15 min — keys are short, so guessing must be slow
const MAX_FAILS_PER_IP = 30;
const MAX_SIGNUPS_PER_IP = 5; // per 15 min

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: ONE_YEAR,
};

export async function clientIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

export async function findUserByName(name: string) {
  const db = await getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.name}) = lower(${name.trim()})`);
  return user ?? null;
}

async function recentAttempts(kind: 'login_fail' | 'register', where: { name?: string; ip?: string }) {
  const db = await getDb();
  const since = new Date(Date.now() - WINDOW_MS);
  const conds = [eq(authAttempts.kind, kind), gte(authAttempts.at, since)];
  if (where.name) conds.push(sql`lower(${authAttempts.name}) = lower(${where.name})`);
  if (where.ip) conds.push(eq(authAttempts.ip, where.ip));
  const [{ n }] = await db.select({ n: count() }).from(authAttempts).where(and(...conds));
  return n;
}

export async function recordAttempt(kind: 'login_fail' | 'register', name: string | null, ip: string) {
  const db = await getDb();
  await db.insert(authAttempts).values({ kind, name, ip });
}

export async function signupsBlocked(ip: string) {
  return (await recentAttempts('register', { ip })) >= MAX_SIGNUPS_PER_IP;
}

export type LoginResult = { user: User } | { error: 'invalid' | 'throttled' };

export async function checkLogin(name: string, key: string, ip: string): Promise<LoginResult> {
  if (
    (await recentAttempts('login_fail', { name })) >= MAX_FAILS_PER_NAME ||
    (await recentAttempts('login_fail', { ip })) >= MAX_FAILS_PER_IP
  ) {
    return { error: 'throttled' };
  }
  const user = name && key ? await findUserByName(name) : null;
  if (user?.active && (await verifyKey(key, user.keyHash))) return { user };
  await recordAttempt('login_fail', name || null, ip);
  return { error: 'invalid' };
}

// Returns the cookie to set; callers apply it (Server Action → cookies(), Route Handler → response).
export async function createSession(userId: number) {
  const token = newSessionToken();
  const db = await getDb();
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token) });
  return { name: SESSION_COOKIE, value: token, options: cookieOptions };
}

export async function startSession(userId: number) {
  const c = await createSession(userId);
  (await cookies()).set(c.name, c.value, c.options);
}

// Signs the user out everywhere (key change, turned off).
export async function revokeSessions(userId: number) {
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

// Once per request.
export const getUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)));
  const user = row?.user.active ? row.user : null;
  if (user && (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 10 * 60_000)) {
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
  }
  return user;
});

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/listings');
  return user;
}
