import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDraftSession,
  verifyDraftPassword,
  verifyDraftSession,
  DRAFT_SESSION_TTL_SECONDS,
} from '../lib/draft-auth.ts';

const secret = 'offline-test-secret-that-is-long-enough-123456';
const now = 1_800_000_000_000;

test('valid session is accepted before expiry', () => {
  const token = createDraftSession(secret, now);
  assert.equal(verifyDraftSession(token, secret, now + 1000), true);
});

test('expired session is rejected', () => {
  const token = createDraftSession(secret, now);
  assert.equal(
    verifyDraftSession(
      token,
      secret,
      now + DRAFT_SESSION_TTL_SECONDS * 1000,
    ),
    false,
  );
});

test('session signed with a different secret is rejected', () => {
  const token = createDraftSession(secret, now);
  assert.equal(
    verifyDraftSession(token, 'a-different-test-secret-123456789012', now),
    false,
  );
});

test('tampered session is rejected', () => {
  const token = createDraftSession(secret, now);
  const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
  assert.equal(verifyDraftSession(tampered, secret, now), false);
});

test('missing and malformed sessions are rejected', () => {
  assert.equal(verifyDraftSession(undefined, secret, now), false);
  assert.equal(verifyDraftSession('not-a-session', secret, now), false);
});

test('password comparison accepts the correct password only', () => {
  assert.equal(verifyDraftPassword(secret, secret), true);
  assert.equal(verifyDraftPassword('wrong-password', secret), false);
  assert.equal(verifyDraftPassword(undefined, secret), false);
});