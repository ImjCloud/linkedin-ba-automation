import { NextRequest, NextResponse } from 'next/server';
import { generateDraft } from '@/lib/content';
import { alertFailure } from '@/lib/alerts';
import { createSavedDraft } from '@/lib/draft-store';
import { getRedis } from '@/lib/redis';
import { logPublishingEvent } from '@/lib/redis-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function lagosDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function safeLog(
  status: string,
  details: Record<string, unknown>,
  draftId: string | null,
): Promise<void> {
  try {
    await logPublishingEvent('scheduled_draft_generation', status, details, draftId);
  } catch (error) {
    console.error(
      'Failed to record scheduled draft event:',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'Cron authentication is not configured.' },
      { status: 503 },
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const day = lagosDay();
  const redis = getRedis();
  const lockKey = `linkedin:scheduled-draft:${day}`;
  const acquired = await redis.set(lockKey, 'generating', { nx: true, ex: 600 });

  if (acquired !== 'OK') {
    const existing = await redis.get<string>(lockKey);
    return NextResponse.json({
      ok: true,
      skipped: true,
      published: false,
      reason: 'A scheduled draft attempt already exists for this Lagos calendar day.',
      state: existing === 'generating' ? 'in_progress' : 'already_created',
    });
  }

  try {
    const generated = await generateDraft();
    const draft = await createSavedDraft({
      topic: generated.topic,
      text: generated.text,
      sources: generated.sources,
      reviewStatus: 'Not reviewed',
      checks: generated.checks,
    });

    await redis.set(lockKey, `draft:${draft.id}`, { ex: 8 * 24 * 60 * 60 });
    await safeLog(
      generated.checks.passed ? 'success' : 'needs_review',
      {
        scheduled_day: day,
        topic: draft.topic,
        sourceCount: draft.sources.length,
        qualityChecks: generated.checks.reasons,
        published: false,
      },
      draft.id,
    );

    return NextResponse.json(
      {
        ok: true,
        published: false,
        draftId: draft.id,
        scheduledDay: day,
        checks: generated.checks,
        message: generated.checks.passed
          ? 'Scheduled draft generated and saved for human review.'
          : 'Scheduled draft saved, but quality checks require human review.',
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    try {
      if ((await redis.get<string>(lockKey)) === 'generating') {
        await redis.del(lockKey);
      }
    } catch {
      // Preserve the generation failure if lock cleanup is unavailable.
    }

    await safeLog('failed', { scheduled_day: day, message: message.slice(0, 300) }, null);

    try {
      await alertFailure('Scheduled draft generation failed', `Lagos day: ${day}\n${message}`);
    } catch {
      // Alerting must not mask the original failure.
    }

    console.error('Scheduled draft generation failed:', message);
    return NextResponse.json(
      {
        ok: false,
        published: false,
        error: 'Scheduled draft generation failed. Check server logs and provider configuration.',
      },
      { status: 502 },
    );
  }
}
