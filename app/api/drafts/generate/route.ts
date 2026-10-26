import { NextRequest, NextResponse } from 'next/server';
import { DRAFT_SESSION_COOKIE, getDraftAccessSecret, verifyDraftSession } from '@/lib/draft-auth';
import { generateDraft } from '@/lib/content';
import { createSavedDraft } from '@/lib/draft-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const protocol = forwardedProto?.split(',')[0]?.trim()
    || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  if (!origin || !host) return false;
  try { return new URL(origin).origin === `${protocol}://${host}`; }
  catch { return false; }
}

function authorized(request: NextRequest): boolean {
  const secret = getDraftAccessSecret();
  const token = request.cookies.get(DRAFT_SESSION_COOKIE)?.value;
  return Boolean(secret && verifyDraftSession(token, secret));
}

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) {
    return NextResponse.json({ ok: false, error: 'Request origin could not be verified.' }, { status: 403 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'Sign in before generating a draft.' }, { status: 401 });
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
    return NextResponse.json(
      { ok: true, published: false, mode: 'gemini', draft },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Gemini draft generation failed:', error instanceof Error ? error.message : 'Unknown generation error');
    return NextResponse.json(
      { ok: false, published: false, error: 'Gemini could not generate a draft. Check server logs and Gemini configuration, then try again.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
