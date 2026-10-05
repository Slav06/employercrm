import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { LoginForm } from './forms';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: PageProps<'/login'>) {
  if (await getUser()) redirect('/listings');
  const { error } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <LoginForm notice={typeof error === 'string' ? error : undefined} />
    </div>
  );
}
