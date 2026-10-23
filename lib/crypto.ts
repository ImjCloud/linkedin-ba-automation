import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

// Domain-separate the OAuth state key from cron authentication. OAuth must not
// depend on CRON_SECRET being available to the authorization-start route.
function oauthStateKey(): Buffer {
  return createHmac('sha256', env('LINKEDIN_CLIENT_SECRET'))
    .update('linkedin-oauth-state-v1')
    .digest();
}

export function signState(state: string) {
  return createHmac('sha256', oauthStateKey()).update(state).digest('hex');
}

export function verifyState(state: string, signature: string) {
  const expected = Buffer.from(signState(state), 'hex');
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function randomState() {
  return randomBytes(32).toString('hex');
}
