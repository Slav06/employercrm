import { NextResponse, type NextRequest } from 'next/server';
import { cookieOptions, findUserByKey, KEY_COOKIE } from '@/lib/auth';

// Bookmarkable login link: /auth?key=crm_… sets the cookie and lands on the dashboard.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')?.trim();
  const user = await findUserByKey(key);
  const res = NextResponse.redirect(new URL(user ? '/' : '/login?error=1', req.url));
  if (user && key) res.cookies.set(KEY_COOKIE, key, cookieOptions);
  return res;
}
