import { redirect } from 'next/navigation';
import { login } from '@/app/auth-actions';
import { getUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: PageProps<'/login'>) {
  if (await getUser()) redirect('/');
  const { error } = await searchParams;

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <form action={login} className="card space-y-3">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-zinc-500">Paste the secret key your admin gave you, or open your login link.</p>
        <input name="key" type="password" autoComplete="current-password" placeholder="crm_…" required autoFocus className="input" />
        {error && <p className="text-sm text-red-600">That key isn’t valid or was turned off.</p>}
        <button className="btn btn-primary w-full">Sign in</button>
      </form>
    </div>
  );
}
