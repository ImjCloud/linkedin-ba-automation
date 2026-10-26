import { NextRequest, NextResponse } from 'next/server';
import {
  DRAFT_SESSION_COOKIE,
  getDraftAccessSecret,
  verifyDraftSession,
} from '@/lib/draft-auth';
import { validateDraft, type DraftSource } from '@/lib/content-quality';
import {
  createSavedDraft,
  listSavedDrafts,
  type DraftReviewStatus,
} from '@/lib/draft-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const statuses: DraftReviewStatus[] = [
  'Not reviewed',
  'Approved locally',
  'Returned for revision',
];

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
    const parsedOrigin = new URL(origin);
    return parsedOrigin.origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

function parseDraft(body: unknown): {
  topic: string;
  text: string;
  sources: DraftSource[];
  reviewStatus: DraftReviewStatus;
} | null {
  if (typeof body !== 'object' || body === null) return null;

  const data = body as Record<string, unknown>;
  if (
    typeof data.topic !== 'string' ||
    data.topic.length > 160 ||
    typeof data.text !== 'string' ||
    data.text.length > 3500 ||
    !Array.isArray(data.sources) ||
    data.sources.length > 10
  ) return null;

  const sources: DraftSource[] = [];
  for (const source of data.sources) {
    if (typeof source !== 'object' || source === null) return null;
    const item = source as Record<string, unknown>;
    if (
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 200 ||
      typeof item.url !== 'string' ||
      item.url.length > 2048
    ) return null;

    try {
      const sourceUrl = new URL(item.url);
      if (
        sourceUrl.protocol !== 'https:' ||
        !sourceUrl.hostname ||
        sourceUrl.username ||
        sourceUrl.password
      ) return null;
    } catch {
      return null;
    }

    sources.push({ title: item.title.trim(), url: item.url });
  }

  const reviewStatus = data.reviewStatus ?? 'Not reviewed';
  if (
    typeof reviewStatus !== 'string' ||
    !statuses.includes(reviewStatus as DraftReviewStatus)
  ) return null;

  return {
    topic: data.topic.trim(),
    text: data.text,
    sources,
    reviewStatus: reviewStatus as DraftReviewStatus,
  };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to access saved drafts.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const drafts = await listSavedDrafts();
    return NextResponse.json(
      { ok: true, drafts },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Saved drafts could not be loaded.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) {
    return NextResponse.json(
      { ok: false, error: 'Request origin could not be verified.' },
      { status: 403 },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Sign in before saving a draft.' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON request.' },
      { status: 400 },
    );
  }

  const parsed = parseDraft(body);
  if (!parsed) {
    return NextResponse.json(
      { ok: false, error: 'Draft fields are invalid or exceed allowed limits.' },
      { status: 400 },
    );
  }

  const checks = validateDraft(parsed.topic, parsed.text, parsed.sources);
  if (parsed.reviewStatus === 'Approved locally' && !checks.passed) {
    return NextResponse.json(
      { ok: false, error: 'Resolve all validation issues before approving this draft.', checks },
      { status: 422 },
    );
  }

  try {
    const draft = await createSavedDraft({ ...parsed, checks });
    return NextResponse.json(
      { ok: true, draft },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'The draft could not be saved.' },
      { status: 503 },
    );
  }
}
