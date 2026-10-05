import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
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

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <header className="border-b border-zinc-200 bg-white">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold">
              EmployerCRM
            </Link>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-sm text-zinc-600 hover:text-zinc-900">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
