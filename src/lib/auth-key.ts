import { createHash, randomBytes } from 'node:crypto';

export const generateKey = () => `crm_${randomBytes(24).toString('base64url')}`;
export const hashKey = (key: string) => createHash('sha256').update(key.trim()).digest('hex');
