import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '@/db';
import { users, type User } from '@/db/schema';
import { KEY_COOKIE } from './auth-cookie';
import { hashKey } from './auth-key';

export { KEY_COOKIE };
export { generateKey, hashKey } from './auth-key';

// Login = a per-user secret key. The browser keeps it in an httpOnly cookie; the DB
// only stores its SHA-256, so keys can't be read back — only regenerated.
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function findUserByKey(key: string | undefined | null): Promise<User | null> {
  if (!key || key.length < 10) return null;
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.keyHash, hashKey(key)));
  return user?.active ? user : null;
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: ONE_YEAR,
};

// Once per request.
export const getUser = cache(async (): Promise<User | null> => {
  const key = (await cookies()).get(KEY_COOKIE)?.value;
  const user = await findUserByKey(key);
  if (user && (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 10 * 60_000)) {
    const db = await getDb();
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
  if (user.role !== 'admin') redirect('/');
  return user;
}
