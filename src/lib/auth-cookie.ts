// Shared with proxy.ts, which can't import the DB.
export const SESSION_COOKIE = 'crm_session';
// Remembers the last name signed in on this device, so the login page only has to
// ask for the key. Not a secret and not a credential — the key is still required.
export const REMEMBER_COOKIE = 'crm_name';
