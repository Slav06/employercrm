'use client';

import { useActionState, useState } from 'react';
import { createUser, regenerateKey, type KeyResult } from './actions';

function NewKey({ result }: { result: KeyResult }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!result) return null;
  if ('error' in result) return <p className="text-sm text-red-600">{result.error}</p>;
  const link = `${window.location.origin}/auth?${new URLSearchParams({ name: result.name, key: result.key })}`;
  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
  };
  return (
    <div className="mt-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium">
        {result.name} signs in with key <span className="font-mono">{result.key}</span> — note it now, it won’t be shown
        again.
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn py-1 text-xs" onClick={() => copy('key', result.key)}>
          {copied === 'key' ? 'Copied ✓' : 'Copy key'}
        </button>
        <button type="button" className="btn py-1 text-xs" onClick={() => copy('link', link)}>
          {copied === 'link' ? 'Copied ✓' : 'Copy login link'}
        </button>
      </div>
      <p className="text-xs text-zinc-500">The login link signs them in with one click — share it privately.</p>
    </div>
  );
}

export function CreateUserForm() {
  const [result, action, pending] = useActionState(createUser, null);
  return (
    <div className="card">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label className="label">Name</label>
          <input name="name" required placeholder="Jane" className="input" />
        </div>
        <div className="w-40">
          <label className="label">Key (blank = random)</label>
          <input name="key" placeholder="tiger42" pattern="[a-zA-Z]{3,20}[0-9]{2}" className="input font-mono" />
        </div>
        <div>
          <label className="label">Role</label>
          <select name="role" defaultValue="member" className="input">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="btn btn-primary" disabled={pending}>
          Add user
        </button>
      </form>
      <NewKey result={result} />
    </div>
  );
}

export function RegenerateKeyForm({ id }: { id: number }) {
  const [result, action, pending] = useActionState(regenerateKey, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm('Issue a new key? Their current key and login link stop working.')) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="text-xs hover:underline" disabled={pending}>
        New key
      </button>
      <NewKey result={result} />
    </form>
  );
}
