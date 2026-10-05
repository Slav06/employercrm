import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth-cookie';

// Optimistic check only: no cookie → login page. Pages and Server Actions verify
// the session against the database themselves (requireUser).
export function proxy(request: NextRequest) {
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: ['/((?!login|register|auth|api/fetch|_next/static|_next/image|favicon.ico).*)'],
};
