import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// Easy keys: a word + 2 digits, e.g. "tiger42". Short on purpose, so logins also
// need the user's name and repeated failures are throttled (see auth.ts).
export const KEY_RULE = 'a word (3–20 letters) followed by 2 numbers, e.g. tiger42';
const KEY_RE = /^[a-z]{3,20}[0-9]{2}$/;

export const normalizeKey = (key: string) => key.trim().toLowerCase();
export const isValidKey = (key: string) => KEY_RE.test(normalizeKey(key));

const WORDS = (
  'apple amber anchor arrow atlas autumn bamboo beacon berry bison blaze bloom brave breeze brook ' +
  'cactus candle canyon cedar cherry citrus clover cobalt comet coral cosmic cotton crane crystal ' +
  'dawn delta desert dolphin dragon eagle echo ember falcon fern fiesta flame forest fox galaxy ' +
  'garden ginger glacier golden granite harbor hawk hazel honey horizon island ivory jade jaguar ' +
  'jasmine jungle kite koala lagoon lemon lily lime lotus lunar maple marble meadow mango mint ' +
  'monkey moon nectar noble north oasis ocean olive onyx orbit orchid otter owl palm panda ' +
  'pearl pepper phoenix pine planet plum polar prairie quartz rain raven reef river robin rocket ' +
  'ruby saffron sage salmon sapphire shadow sierra silver sky solar spark spruce star stone storm ' +
  'summit sun swift tango tiger topaz tulip tundra velvet violet volcano walnut willow wolf zebra'
).split(' ');

export function generateKey() {
  return `${WORDS[randomInt(WORDS.length)]}${String(randomInt(100)).padStart(2, '0')}`;
}

export async function hashKey(key: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(normalizeKey(key), salt, 32);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyKey(key: string, stored: string) {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = await scryptAsync(normalizeKey(key), Buffer.from(saltHex, 'hex'), 32);
  return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// Session tokens are long random strings, so a fast hash is fine.
export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
