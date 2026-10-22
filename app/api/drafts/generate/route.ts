import { NextRequest, NextResponse } from 'next/server';
import { generateDraft } from '@/lib/content';
import { validateDraft } from '@/lib/content-quality';
import {
  DRAFT_SESSION_COOKIE,
  getDraftAccessSecret,
  verifyDraftSession,
} from '@/lib/draft-auth';
import { alertFailure } from '@/lib/alerts';
import { createSavedDraft } from '@/lib/draft-store';
import { logPublishingEvent } from '@/lib/redis-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
      { status: 403 },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Sign in before generating a draft.' },
      { status: 401 },
    );
  }

  try {
    const generated = await generateDraft();
    const checks = validateDraft(
      generated.topic,
      generated.text,
      generated.sources,
    );

    const draft = await createSavedDraft({
      topic: generated.topic,
      text: generated.text,
      sources: generated.sources,
      reviewStatus: 'Not reviewed',
      checks,
    });

    try {
      await logPublishingEvent(
        'draft_generation',
        checks.passed ? 'success' : 'needs_review',
        {
          topic: draft.topic,
          sourceCount: draft.sources.length,
          checks: checks.reasons,
          mode: 'manual',
        },
        draft.id,
      );
    } catch (error) {
      console.error(
        'Failed to record draft generation event:',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }

    return NextResponse.json(
      {
        ok: true,
        published: false,
        draft,
        message: checks.passed
          ? 'Draft generated and saved for review.'
          : 'Draft generated and saved, but quality checks require review.',
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    try {
      await logPublishingEvent(
        'draft_generation',
        'failed',
        { message: message.slice(0, 300) },
        null,
      );
    } catch {
      // Preserve the original generation failure if event logging is unavailable.
    }

    try {
      await alertFailure('Manual draft generation failed', message);
    } catch {
      // Alerting must not mask the generation error.
    }

    console.error('Manual draft generation failed:', message);
    return NextResponse.json(
      {
        ok: false,
        published: false,
        error: 'Draft generation failed. Check server logs and provider configuration.',
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
