import { createHmac, timingSafeEqual } from 'node:crypto';

export const DRAFT_SESSION_COOKIE = 'draft_access_session';
export const DRAFT_SESSION_TTL_SECONDS = 8 * 60 * 60;

export function getDraftAccessSecret(): string | null {
  const secret = process.env.DRAFTS_ACCESS_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function signature(expiry: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${DRAFT_SESSION_COOKIE}:${expiry}`)
    .digest('hex');
}

export function verifyDraftPassword(
  supplied: unknown,
  secret: string,
): boolean {
  return typeof supplied === 'string' && safeEqual(supplied, secret);
}

export function createDraftSession(
  secret: string,
  now = Date.now(),
): string {
  const expiry = String(now + DRAFT_SESSION_TTL_SECONDS * 1000);
  return `${expiry}.${signature(expiry, secret)}`;
}

export function verifyDraftSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!token) return false;

  const separator = token.indexOf('.');
  if (separator <= 0) return false;

  const expiry = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);

  if (!/^\d{13}$/.test(expiry)) return false;
  if (!/^[a-f0-9]{64}$/.test(suppliedSignature)) return false;

  const expiryMs = Number(expiry);
  if (!Number.isSafeInteger(expiryMs) || expiryMs <= now) return false;
  if (expiryMs > now + DRAFT_SESSION_TTL_SECONDS * 1000) return false;

  return safeEqual(suppliedSignature, signature(expiry, secret));
}