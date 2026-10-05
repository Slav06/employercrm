'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { checkLogin, clientIp, endSession, findUserByName, recordAttempt, signupsBlocked, startSession } from '@/lib/auth';
import { hashKey, isValidKey, KEY_RULE, normalizeKey } from '@/lib/auth-key';

export type FormState = { error: string; name?: string } | null;

const field = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = field(formData, 'name');
  const key = normalizeKey(field(formData, 'key'));
  const result = await checkLogin(name, key, await clientIp());
  if ('error' in result) {
    return {
      name,
      error:
        result.error === 'throttled'
          ? 'Too many wrong tries. Wait 15 minutes and try again.'
          : 'Name or key is wrong.',
    };
  }
  await startSession(result.user.id);
  redirect('/listings');
}

export async function register(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = field(formData, 'name').replace(/\s+/g, ' ');
  const key = normalizeKey(field(formData, 'key'));
  const ip = await clientIp();

  if (name.length < 2 || name.length > 40) return { name, error: 'Name must be 2–40 characters.' };
  if (!isValidKey(key)) return { name, error: `Key must be ${KEY_RULE}.` };
  if (await signupsBlocked(ip)) return { name, error: 'Too many sign-ups from here. Try again later.' };
  if (await findUserByName(name)) return { name, error: 'That name is taken — add a last initial, e.g. “Maria G”.' };

  const db = await getDb();
  const [user] = await db
    .insert(users)
    .values({ name, keyHash: await hashKey(key), role: 'member', selfRegistered: true })
    .onConflictDoNothing()
    .returning();
  if (!user) return { name, error: 'That name is taken — add a last initial, e.g. “Maria G”.' };
  await recordAttempt('register', name, ip);
  await startSession(user.id);
  redirect('/listings');
}

export async function logout() {
  await endSession();
  redirect('/login');
}
