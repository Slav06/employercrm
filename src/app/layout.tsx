import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { logout } from '@/app/auth-actions';
import { getUser } from '@/lib/auth';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'EmployerCRM',
  description: 'Find businesses that are hiring, pitch them, track replies.',
  // No login, so keep it out of search engines.
  robots: { index: false, follow: false },
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/listings', label: 'Inbox' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/searches', label: 'Searches' },
];

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const user = await getUser();
  const nav = user?.role === 'admin' ? [...NAV, { href: '/users', label: 'Users' }] : NAV;
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <header className="border-b border-zinc-200 bg-white">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold">
              EmployerCRM
            </Link>
            {user &&
              nav.map((n) => (
                <Link key={n.href} href={n.href} className="text-sm text-zinc-600 hover:text-zinc-900">
                  {n.label}
                </Link>
              ))}
            {user && (
              <form action={logout} className="ml-auto flex items-center gap-3 text-sm text-zinc-500">
                <span>{user.name}</span>
                <button className="hover:text-zinc-900 hover:underline">Sign out</button>
              </form>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
