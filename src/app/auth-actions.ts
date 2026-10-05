'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieOptions, findUserByKey, KEY_COOKIE } from '@/lib/auth';

export async function login(formData: FormData) {
  const key = String(formData.get('key') ?? '').trim();
  const user = await findUserByKey(key);
  if (!user) redirect('/login?error=1');
  (await cookies()).set(KEY_COOKIE, key, cookieOptions);
  redirect('/');
}

export async function logout() {
  (await cookies()).delete(KEY_COOKIE);
  redirect('/login');
}
