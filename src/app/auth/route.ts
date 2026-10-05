import { NextResponse, type NextRequest } from 'next/server';
import { checkLogin, clientIp, createSession } from '@/lib/auth';
import { normalizeKey } from '@/lib/auth-key';

// One-click login link: /auth?name=Maria&key=tiger42
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const name = sp.get('name')?.trim() ?? '';
  const result = await checkLogin(name, normalizeKey(sp.get('key') ?? ''), await clientIp());
  if ('error' in result) {
    return NextResponse.redirect(new URL(`/login?error=${result.error}`, req.url));
  }
  const res = NextResponse.redirect(new URL('/', req.url));
  const c = await createSession(result.user.id);
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
