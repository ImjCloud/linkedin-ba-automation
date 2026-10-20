import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { generateDraft } from '@/lib/content';
import { alertFailure } from '@/lib/alerts';
import { decryptToken } from '@/lib/token-vault';
import { publishMemberPost } from '@/lib/linkedin';
import {
  getCredentials,
  getDailyPost,
  reserveDailyPost,
  updateDailyPost,
  logPublishingEvent,
  type DailyPost,
} from '@/lib/redis-store';

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
  eventType: string,
  status: string,
  details: Record<string, unknown> = {},
  postId: string | null = null,
): Promise<void> {
  try {
    await logPublishingEvent(eventType, status, details, postId);
  } catch (error) {
    console.error(
      'Failed to persist publishing event:',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

async function safeAlert(title: string, detail: string): Promise<void> {
  try {
    await alertFailure(title, detail);
  } catch (error) {
    console.error(
      'Failed to send workflow alert:',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

function existingRecordResponse(post: DailyPost) {
  if (post.status === 'published') {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'A post has already been published for this Lagos calendar day.',
      postId: post.id,
    });
  }

  if (post.status === 'blocked') {
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        skipped: true,
        reason: 'A post already failed quality checks for this Lagos calendar day.',
        postId: post.id,
        reasons: post.quality_checks?.reasons ?? [],
      },
      { status: 422 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      skipped: true,
      manualReviewRequired: true,
      reason: `An existing daily record has status "${post.status}". Automatic retry is disabled to prevent duplicate publication.`,
      postId: post.id,
    },
    { status: 409 },
  );
}

export async function GET(request: NextRequest) {
  if (process.env.ENABLE_LINKEDIN_PUBLISHING?.trim().toLowerCase() !== 'true') {
    return NextResponse.json(
      {
        ok: false,
        published: false,
        publishingDisabled: true,
        error: 'LinkedIn publishing is disabled.',
      },
      { status: 503 },
    );
  }
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'Cron authentication is not configured.' },
      { status: 503 },
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const day = lagosDay();
  let reserved = false;

  try {
    // Check existing work before attempting any new generation.
    const existing = await getDailyPost(day);

    if (existing) {
      if (
        existing.status === 'generating' ||
        existing.status === 'publishing' ||
        existing.status === 'failed'
      ) {
        await safeAlert(
          'Daily post requires manual review',
          `Lagos day: ${day}\nExisting status: ${existing.status}\nPost ID: ${existing.id}\nAutomatic republishing was prevented.`,
        );
      }

      return existingRecordResponse(existing);
    }

    // Validate LinkedIn credentials before reserving the day.
    const credentials = await getCredentials();

    if (!credentials) {
      throw new Error(
        'LinkedIn profile is not connected. Complete the LinkedIn OAuth connection first.',
      );
    }

    if (
      !Number.isFinite(new Date(credentials.expires_at).getTime()) ||
      new Date(credentials.expires_at).getTime() < Date.now() + 120000
    ) {
      throw new Error(
        'LinkedIn access token is expired or nearly expired. Reconnect the profile before publishing.',
      );
    }

    // Reserve the day atomically BEFORE calling Gemini.
    const now = new Date().toISOString();

    const reservation: DailyPost = {
      id: day,
      scheduled_day: day,
      topic: 'Draft generation pending',
      text: '',
      sources: [],
      content_hash: '',
      status: 'generating',
      quality_checks: {
        passed: false,
        reasons: ['Draft generation has not completed.'],
      },
      created_at: now,
      updated_at: now,
    };

    const acquired = await reserveDailyPost(day, reservation);

    if (!acquired) {
      const concurrentRecord = await getDailyPost(day);

      if (concurrentRecord) {
        return existingRecordResponse(concurrentRecord);
      }

      throw new Error(
        'Daily post reservation failed and no existing record could be retrieved. Publication stopped.',
      );
    }

    reserved = true;

    // Only the request that acquired the reservation reaches this point.
    const draft = await generateDraft();
    const hash = createHash('sha256')
      .update(draft.text.trim())
      .digest('hex');

    await updateDailyPost(day, {
      topic: draft.topic,
      text: draft.text,
      sources: draft.sources,
      content_hash: hash,
      quality_checks: draft.checks,
      status: draft.checks.passed ? 'publishing' : 'blocked',
    });

    if (!draft.checks.passed) {
      await safeLog(
        'quality_check',
        'blocked',
        { topic: draft.topic, reasons: draft.checks.reasons },
        day,
      );

      await safeAlert(
        'Post blocked by quality checks',
        `Lagos day: ${day}\nTopic: ${draft.topic}\nReasons: ${draft.checks.reasons.join('; ')}`,
      );

      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          published: false,
          reasons: draft.checks.reasons,
        },
        { status: 422 },
      );
    }

    await safeLog(
      'quality_check',
      'passed',
      { topic: draft.topic, sources: draft.sources, content_hash: hash },
      day,
    );

    // Do not automatically retry if the publication outcome is ambiguous.
    const published = await publishMemberPost(
      decryptToken(credentials.access_token_encrypted),
      credentials.member_id,
      draft.text,
    );

    await updateDailyPost(day, {
      status: 'published',
      linkedin_post_urn: published.postUrn,
      published_at: new Date().toISOString(),
      linkedin_response: { status: published.status },
    });

    await safeLog(
      'publish',
      'success',
      { post_urn: published.postUrn, http_status: published.status },
      day,
    );

    return NextResponse.json({
      ok: true,
      published: true,
      topic: draft.topic,
      postUrn: published.postUrn,
      day,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown workflow error';

    if (reserved) {
      try {
        await updateDailyPost(day, {
          status: 'failed',
          error_message: message,
          manual_review_required: true,
        });
      } catch (recordError) {
        console.error(
          'Could not update the reserved daily record:',
          recordError instanceof Error
            ? recordError.message
            : 'Unknown error',
        );
      }
    }

    await safeLog(
      'workflow',
      'failed',
      {
        day,
        message,
        manual_review_required: reserved,
      },
      reserved ? day : null,
    );

    await safeAlert(
      reserved
        ? 'Daily publishing workflow requires manual review'
        : 'Daily workflow failed',
      `Lagos day: ${day}\nError: ${message}\nAutomatic retry: disabled.`,
    );

    console.error('Daily LinkedIn workflow failed:', message);

    return NextResponse.json(
      {
        ok: false,
        error: 'The daily workflow failed. Check server logs and alerts.',
        manualReviewRequired: reserved,
      },
      { status: 500 },
    );
  }
}
