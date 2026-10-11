import { redirect } from 'next/navigation';
import { getUser, rememberedName } from '@/lib/auth';
import { LoginForm } from './forms';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: PageProps<'/login'>) {
  if (await getUser()) redirect('/listings');
  const sp = await searchParams;
  // ?switch=1 ignores the remembered name so you can sign in as someone else.
  const remembered = sp.switch ? null : await rememberedName();
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <LoginForm
        notice={typeof sp.error === 'string' ? sp.error : undefined}
        rememberedName={remembered ?? undefined}
      />
    </div>
  );
}
