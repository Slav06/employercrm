import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { generateKey } from '@/lib/auth-key';
import { RegisterForm } from '@/app/login/forms';

export const dynamic = 'force-dynamic';

export default async function Register() {
  if (await getUser()) redirect('/');
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <RegisterForm suggestion={generateKey()} />
    </div>
  );
}
