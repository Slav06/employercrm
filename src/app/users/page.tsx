import { asc } from 'drizzle-orm';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { requireAdmin } from '@/lib/auth';
import { ago } from '@/lib/format';
import { setRole, toggleUser } from './actions';
import { CreateUserForm, RegenerateKeyForm } from './key-forms';

export const dynamic = 'force-dynamic';

export default async function Users() {
  const me = await requireAdmin();
  const db = await getDb();
  const rows = await db.select().from(users).orderBy(asc(users.id));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Users</h1>
      <p className="text-sm text-zinc-500">
        Everyone signs in with their name + a key (a word and 2 numbers). People can also sign themselves up at{' '}
        <code className="text-xs">/register</code> as members. Keys are stored hashed, so a forgotten key can’t be
        looked up — give them a new one. Turning someone off signs them out immediately.
      </p>

      <CreateUserForm />

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Role</th>
              <th className="px-2 py-2 font-medium">Last active</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'text-zinc-400'}>
                <td className="px-4 py-2 font-medium">
                  {u.name}
                  {u.id === me.id && <span className="ml-1 text-xs font-normal text-zinc-400">(you)</span>}
                  {u.selfRegistered && <span className="ml-1 text-xs font-normal text-zinc-400">· signed up</span>}
                </td>
                <td className="px-2 py-2">
                  {u.id === me.id ? (
                    <span className="capitalize">{u.role}</span>
                  ) : (
                    <form action={setRole} className="flex gap-1">
                      <input type="hidden" name="id" value={u.id} />
                      <select name="role" defaultValue={u.role} className="input w-28 py-0.5">
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button className="text-xs hover:underline">Save</button>
                    </form>
                  )}
                </td>
                <td className="px-2 py-2 text-zinc-500">{ago(u.lastSeenAt)}</td>
                <td className="px-2 py-2">{u.active ? 'Active' : 'Off'}</td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-start justify-end gap-3">
                    <RegenerateKeyForm id={u.id} />
                    {u.id !== me.id && (
                      <form action={toggleUser}>
                        <input type="hidden" name="id" value={u.id} />
                        <button className="text-xs hover:underline">{u.active ? 'Turn off' : 'Turn on'}</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
