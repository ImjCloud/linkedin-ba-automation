import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

export function signState(state: string) {
  return createHmac('sha256', env('CRON_SECRET')).update(state).digest('hex');
}
export function verifyState(state: string, signature: string) {
  const expected = Buffer.from(signState(state), 'hex');
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, 'hex'); } catch { return false; }
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
export function randomState() { return randomBytes(32).toString('hex'); }
