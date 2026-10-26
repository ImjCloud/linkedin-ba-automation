import { NextRequest, NextResponse } from 'next/server';
import {
  DRAFT_SESSION_COOKIE,
  getDraftAccessSecret,
  verifyDraftSession,
} from '@/lib/draft-auth';
import { validateDraft } from '@/lib/content-quality';
import { getSavedDraft, draftKey } from '@/lib/draft-store';
import { getRedis } from '@/lib/redis';
import { getCredentials } from '@/lib/redis-store';
import { decryptToken } from '@/lib/token-vault';
import { publishMemberPost } from '@/lib/linkedin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PublishRedis = {
  eval<T = unknown>(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<T>;
};

function publishRedis(): PublishRedis {
  return getRedis() as unknown as PublishRedis;
}

function authorized(request: NextRequest): boolean {
  const secret = getDraftAccessSecret();
  const token = request.cookies.get(DRAFT_SESSION_COOKIE)?.value;
  return Boolean(secret && verifyDraftSession(token, secret));
}

function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const protocol = forwardedProto?.split(',')[0]?.trim()
    || (process.env.NODE_ENV === 'production' ? 'https' : 'http');

  if (!origin || !host) return false;

  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

const RESERVE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end

local record = cjson.decode(raw)
if record.reviewStatus ~= 'Approved locally' then
  return 'not_approved'
end

if record.updated_at ~= ARGV[1] then
  return 'changed'
end

local status = record.publishStatus or 'not_published'
if status ~= 'not_published' then
  return status
end

record.publishStatus = 'publishing'
record.publishAttemptedAt = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(record))
return 'reserved'
`;

const FINISH_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end

local record = cjson.decode(raw)
if record.publishStatus ~= 'publishing' then return 0 end

record.publishStatus = ARGV[1]
record.publishFinishedAt = ARGV[2]

if ARGV[1] == 'published' then
  record.linkedinPostUrn = ARGV[3]
  record.published_at = ARGV[2]
else
  record.publishError = ARGV[3]
end

redis.call('SET', KEYS[1], cjson.encode(record))
return 1
`;

async function finishPublish(
  id: string,
  status: 'not_published' | 'published' | 'manual_review_required',
  detail = '',
): Promise<boolean> {
  const result = await publishRedis().eval<number>(
    FINISH_SCRIPT,
    [draftKey(id)],
    [status, new Date().toISOString(), detail],
  );

  return Number(result) === 1;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (process.env.ENABLE_MANUAL_LINKEDIN_PUBLISHING !== 'true') {
    return NextResponse.json(
      { ok: false, error: 'Manual publishing is disabled by server configuration.' },
      { status: 503 },
    );
  }

  if (!originAllowed(request)) {
    return NextResponse.json(
      { ok: false, error: 'Request origin was not accepted.' },
      { status: 403 },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to the draft workspace first.' },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid draft identifier.' },
      { status: 400 },
    );
  }

  let reserved = false;

  try {
    const draft = await getSavedDraft(id);

    if (!draft) {
      return NextResponse.json(
        { ok: false, error: 'Saved draft not found.' },
        { status: 404 },
      );
    }

    if (draft.reviewStatus !== 'Approved locally') {
      return NextResponse.json(
        { ok: false, error: 'Save and approve this draft before publishing.' },
        { status: 409 },
      );
    }

    const checks = validateDraft(draft.topic, draft.text, draft.sources);
    if (!checks.passed) {
      return NextResponse.json(
        { ok: false, error: 'The saved draft failed content validation.', reasons: checks.reasons },
        { status: 422 },
      );
    }

    const credentials = await getCredentials();
    if (!credentials?.access_token_encrypted || !credentials.member_id) {
      return NextResponse.json(
        { ok: false, error: 'Connect LinkedIn before publishing.' },
        { status: 409 },
      );
    }

    const expiry = Date.parse(credentials.expires_at);
    if (!Number.isFinite(expiry) || expiry <= Date.now() + 120_000) {
      return NextResponse.json(
        { ok: false, error: 'The LinkedIn access token is expired or near expiry. Reconnect LinkedIn first.' },
        { status: 409 },
      );
    }

    const accessToken = decryptToken(credentials.access_token_encrypted);

    const reservation = await publishRedis().eval<string>(
      RESERVE_SCRIPT,
      [draftKey(id)],
      [draft.updated_at, new Date().toISOString()],
    );

    if (reservation !== 'reserved') {
      const messages: Record<string, string> = {
        missing: 'Saved draft not found.',
        not_approved: 'The saved draft is not approved.',
        changed: 'The draft changed. Refresh it and review it again.',
        publishing: 'A publish attempt is already in progress.',
        published: 'This draft has already been published.',
        manual_review_required: 'A previous attempt needs manual verification before another attempt.',
      };

      return NextResponse.json(
        {
          ok: false,
          error: messages[String(reservation)] || 'The draft could not be reserved for publishing.',
        },
        { status: reservation === 'missing' ? 404 : 409 },
      );
    }

    reserved = true;


    let result: Awaited<ReturnType<typeof publishMemberPost>>;
    try {
      result = await publishMemberPost(accessToken, credentials.member_id, draft.text);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      const rejected = /HTTP status (400|401|403|422)\b/.test(message);

      if (rejected) {
        const finalized = await finishPublish(
          id,
          'not_published',
          'LinkedIn rejected the request.',
        );
        if (!finalized) {
          throw new Error('Could not persist the rejected publish outcome.');
        }
        reserved = false;
        return NextResponse.json(
          { ok: false, error: 'LinkedIn rejected the post. Review the connection and draft before trying again.' },
          { status: 502 },
        );
      }

      const finalized = await finishPublish(
        id,
        'manual_review_required',
        'The outcome of the LinkedIn request could not be confirmed.',
      );
      if (!finalized) {
        throw new Error('Could not persist the uncertain publish outcome.');
      }
      reserved = false;

      return NextResponse.json(
        { ok: false, error: 'The publish outcome is uncertain. Check LinkedIn manually before attempting another post.' },
        { status: 502 },
      );
    }

    const finalized = await finishPublish(id, 'published', result.postUrn);
    if (!finalized) {
      throw new Error('LinkedIn confirmed publication, but Redis did not confirm the saved status.');
    }
    reserved = false;

    return NextResponse.json({
      ok: true,
      status: 'published',
      message: 'LinkedIn confirmed the post and returned its identifier.',
    });
  } catch {
    if (reserved) {
      try {
        await finishPublish(
          id,
          'manual_review_required',
          'An internal error occurred after the publish reservation.',
        );
      } catch {
        // Keep the reservation rather than risk an unsafe retry.
      }
    }

    return NextResponse.json(
      { ok: false, error: 'Publishing could not be safely completed. Check the draft and server logs before retrying.' },
      { status: 500 },
    );
  }
}



