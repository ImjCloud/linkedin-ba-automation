import { NextRequest, NextResponse } from 'next/server';
import {
  DRAFT_SESSION_COOKIE,
  getDraftAccessSecret,
  verifyDraftSession,
} from '@/lib/draft-auth';
import { generateDraft } from '@/lib/content';
import { createSavedDraft } from '@/lib/draft-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) {
    return NextResponse.json(
      { ok: false, error: 'Request origin could not be verified.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Sign in before generating a draft.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    // This endpoint deliberately generates and stores a draft only.
    // It must never call the LinkedIn publishing or cron workflow.
    const generated = await generateDraft();
    const draft = await createSavedDraft({
      topic: generated.topic,
      text: generated.text,
      sources: generated.sources,
      checks: generated.checks,
      reviewStatus: 'Not reviewed',
    });

    return NextResponse.json(
      { ok: true, draft, published: false },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const quota = /429|RESOURCE_EXHAUSTED|quota/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        error: quota
          ? 'Gemini quota is currently exhausted. No draft was saved; wait for quota to reset and try again.'
          : 'Draft generation failed. No draft was saved. Check server logs for details.',
        published: false,
      },
      { status: quota ? 429 : 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
