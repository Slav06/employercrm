'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { login, register, type FormState } from '@/app/auth-actions';

const NOTICE: Record<string, string> = {
  invalid: 'That login link is wrong or out of date.',
  throttled: 'Too many wrong tries. Wait 15 minutes and try again.',
};

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(login, null);
  const error = state?.error ?? (notice ? NOTICE[notice] : undefined);
  return (
    <form action={action} className="card space-y-3">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <div>
        <label className="label">Your name</label>
        <input name="name" defaultValue={state?.name} autoComplete="username" required autoFocus className="input" />
      </div>
      <div>
        <label className="label">Your key</label>
        <input name="key" type="password" autoComplete="current-password" placeholder="e.g. tiger42" required className="input" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>
        Sign in
      </button>
      <p className="text-center text-sm text-zinc-500">
        New here?{' '}
        <Link href="/register" className="font-medium text-zinc-900 hover:underline">
          Create your login
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ suggestion }: { suggestion: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(register, null);
  const [key, setKey] = useState(suggestion);
  return (
    <form action={action} className="card space-y-3">
      <h1 className="text-lg font-semibold">Create your login</h1>
      <div>
        <label className="label">Your name</label>
        <input name="name" defaultValue={state?.name} placeholder="Maria G" required autoFocus maxLength={40} className="input" />
      </div>
      <div>
        <label className="label">Pick a key — a word + 2 numbers</label>
        <input
          name="key"
          value={key}
          onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s/g, ''))}
          pattern="[a-z]{3,20}[0-9]{2}"
          title="A word (3–20 letters) followed by 2 numbers, e.g. tiger42"
          autoComplete="new-password"
          required
          className="input font-mono"
        />
        <p className="mt-1 text-xs text-zinc-500">Remember it — you’ll sign in with your name + this key.</p>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>
        Create login
      </button>
      <p className="text-center text-sm text-zinc-500">
        Already have one?{' '}
        <Link href="/login" className="font-medium text-zinc-900 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
