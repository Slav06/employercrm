// Create a user and print their secret key + login link (keys are only shown once).
//   npm run user:add -- "Name" [admin|member]
import { generateKey, hashKey } from '@/lib/auth-key';
import { getDb } from '@/db';
import { users } from '@/db/schema';

const [name, role = 'member'] = process.argv.slice(2);
if (!name || !['admin', 'member'].includes(role)) {
  console.error('usage: npm run user:add -- "Name" [admin|member]');
  process.exit(1);
}

async function main() {
  const key = generateKey();
  const db = await getDb();
  await db.insert(users).values({ name, role: role as 'admin' | 'member', keyHash: hashKey(key) });
  const base = process.env.APP_URL ?? 'https://employercrm.vercel.app';
  console.log(`${name} (${role})\n  key:  ${key}\n  link: ${base}/auth?key=${key}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
