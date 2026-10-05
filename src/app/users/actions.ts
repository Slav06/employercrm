'use server';

import { and, count, eq, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { ROLES, users, type Role } from '@/db/schema';
import { generateKey, hashKey, requireAdmin } from '@/lib/auth';

export type KeyResult = { name: string; key: string } | { error: string } | null;

export async function createUser(_prev: KeyResult, formData: FormData): Promise<KeyResult> {
  await requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const role = String(formData.get('role') ?? 'member') as Role;
  if (!name) return { error: 'Name is required' };
  if (!ROLES.includes(role)) return { error: 'Invalid role' };
  const key = generateKey();
  const db = await getDb();
  await db.insert(users).values({ name, role, keyHash: hashKey(key) });
  revalidatePath('/users');
  return { name, key };
}

// Issues a new key and invalidates the old one (logs that user out everywhere).
export async function regenerateKey(_prev: KeyResult, formData: FormData): Promise<KeyResult> {
  await requireAdmin();
  const id = Number(formData.get('id'));
  const key = generateKey();
  const db = await getDb();
  const [u] = await db.update(users).set({ keyHash: hashKey(key) }).where(eq(users.id, id)).returning();
  if (!u) return { error: 'User not found' };
  revalidatePath('/users');
  return { name: u.name, key };
}

async function otherActiveAdmins(db: Awaited<ReturnType<typeof getDb>>, id: number) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, id)));
  return n;
}

export async function toggleUser(formData: FormData) {
  const me = await requireAdmin();
  const id = Number(formData.get('id'));
  if (id === me.id) throw new Error("You can't deactivate yourself");
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) return;
  await db.update(users).set({ active: !u.active }).where(eq(users.id, id));
  revalidatePath('/users');
}

export async function setRole(formData: FormData) {
  const me = await requireAdmin();
  const id = Number(formData.get('id'));
  const role = String(formData.get('role')) as Role;
  if (!ROLES.includes(role)) throw new Error('Invalid role');
  const db = await getDb();
  if (role !== 'admin' && (await otherActiveAdmins(db, id)) === 0) throw new Error('Keep at least one admin');
  if (id === me.id && role !== 'admin') throw new Error("You can't remove your own admin role");
  await db.update(users).set({ role }).where(eq(users.id, id));
  revalidatePath('/users');
}
