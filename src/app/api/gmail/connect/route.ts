import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { authUrl, gmailConfigured, STATE_COOKIE } from '@/lib/gmail/google';

export async function GET(req: NextRequest) {
  if (!(await getUser())) return NextResponse.redirect(new URL('/login', req.url));
  if (!gmailConfigured()) return NextResponse.redirect(new URL('/settings?gmail=not_configured', req.url));
  const state = randomBytes(16).toString('base64url');
  const res = NextResponse.redirect(authUrl(`${req.nextUrl.origin}/api/gmail/callback`, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/gmail',
    maxAge: 600,
  });
  return res;
}
