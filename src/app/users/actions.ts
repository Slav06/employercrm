'use server';

import { and, count, eq, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { ROLES, users, type Role } from '@/db/schema';
import { findUserByName, requireAdmin, revokeSessions } from '@/lib/auth';
import { generateKey, hashKey, isValidKey, KEY_RULE, normalizeKey } from '@/lib/auth-key';

export type KeyResult = { name: string; key: string } | { error: string } | null;

export async function createUser(_prev: KeyResult, formData: FormData): Promise<KeyResult> {
  await requireAdmin();
  const name = String(formData.get('name') ?? '').trim().replace(/\s+/g, ' ');
  const role = String(formData.get('role') ?? 'member') as Role;
  const key = normalizeKey(String(formData.get('key') ?? '')) || generateKey();
  if (name.length < 2 || name.length > 40) return { error: 'Name must be 2–40 characters' };
  if (!ROLES.includes(role)) return { error: 'Invalid role' };
  if (!isValidKey(key)) return { error: `Key must be ${KEY_RULE}` };
  if (await findUserByName(name)) return { error: 'That name is already used' };
  const db = await getDb();
  await db.insert(users).values({ name, role, keyHash: await hashKey(key) });
  revalidatePath('/users');
  return { name, key };
}

// New key; the old key stops working and the user is signed out everywhere.
export async function regenerateKey(_prev: KeyResult, formData: FormData): Promise<KeyResult> {
  await requireAdmin();
  const id = Number(formData.get('id'));
  const key = generateKey();
  const db = await getDb();
  const [u] = await db.update(users).set({ keyHash: await hashKey(key) }).where(eq(users.id, id)).returning();
  if (!u) return { error: 'User not found' };
  await revokeSessions(id);
  revalidatePath('/users');
  return { name: u.name, key };
}

async function otherActiveAdmins(id: number) {
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, id)));
  return n;
}

export async function toggleUser(formData: FormData) {
  const me = await requireAdmin();
  const id = Number(formData.get('id'));
  if (id === me.id) throw new Error("You can't turn yourself off");
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) return;
  await db.update(users).set({ active: !u.active }).where(eq(users.id, id));
  if (u.active) await revokeSessions(id);
  revalidatePath('/users');
}

export async function setRole(formData: FormData) {
  const me = await requireAdmin();
  const id = Number(formData.get('id'));
  const role = String(formData.get('role')) as Role;
  if (!ROLES.includes(role)) throw new Error('Invalid role');
  if (id === me.id && role !== 'admin') throw new Error("You can't remove your own admin role");
  if (role !== 'admin' && (await otherActiveAdmins(id)) === 0) throw new Error('Keep at least one admin');
  const db = await getDb();
  await db.update(users).set({ role }).where(eq(users.id, id));
  revalidatePath('/users');
}
