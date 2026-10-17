import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { env } from '@/lib/env';
import { getSupabase } from '@/lib/supabase';
import { generateDraft } from '@/lib/content';
import { publishMemberPost } from '@/lib/linkedin';
import { alertFailure } from '@/lib/alerts';
import { decryptToken } from '@/lib/token-vault';
export const runtime = 'nodejs';
export const maxDuration = 120;

async function logEvent(event_type: string, status: string, details: Record<string, unknown> = {}, post_id: string | null = null) {
  const { error } = await getSupabase().from('publishing_events').insert({ event_type, status, details, post_id });
  if (error) console.error('Failed to persist publishing event', error.message);
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!auth || auth !== `Bearer ${env('CRON_SECRET')}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const day = new Date().toISOString().slice(0,10);
  let postId: string | null = null;
  try {
    const { data: creds, error: credentialError } = await getSupabase().from('linkedin_credentials').select('*').eq('id','primary').maybeSingle();
    if (credentialError) throw credentialError;
    if (!creds) throw new Error('LinkedIn profile is not connected. Connect via /api/oauth/linkedin/start.');
    if (new Date(creds.expires_at).getTime() < Date.now() + 120000) throw new Error('LinkedIn access token is expired or nearly expired. Reconnect the profile before publishing. Refresh is attempted only if LinkedIn returned a refresh token; see deployment docs for extending this flow.');

    const { data: existing, error: existingError } = await getSupabase().from('daily_posts').select('id,status').eq('scheduled_day', day).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === 'published') return NextResponse.json({ ok: true, skipped: true, reason: 'Already published for this UTC day', postId: existing.id });
    if (existing) throw new Error(`A post record already exists for ${day} with status ${existing.status}; duplicate prevention stopped the run.`);

    const draft = await generateDraft();
    const hash = createHash('sha256').update(draft.text.trim()).digest('hex');
    if (!draft.checks.passed) {
      const { data: inserted, error } = await getSupabase().from('daily_posts').insert({ scheduled_day: day, topic: draft.topic, text: draft.text, sources: draft.sources, content_hash: hash, status: 'blocked', quality_checks: draft.checks }).select('id').single();
      if (error) throw error;
      postId = inserted.id;
      await logEvent('quality_check','blocked',{ reasons: draft.checks.reasons, topic: draft.topic }, postId);
      await alertFailure('Post blocked by quality checks', `Topic: ${draft.topic}\nReasons: ${draft.checks.reasons.join('; ')}`);
      return NextResponse.json({ ok: false, blocked: true, reasons: draft.checks.reasons }, { status: 422 });
    }

    const { data: inserted, error: insertError } = await getSupabase().from('daily_posts').insert({ scheduled_day: day, topic: draft.topic, text: draft.text, sources: draft.sources, content_hash: hash, status: 'publishing', quality_checks: draft.checks }).select('id').single();
    if (insertError) throw insertError;
    postId = inserted.id;
    await logEvent('quality_check','passed',{ topic: draft.topic, sources: draft.sources, content_hash: hash }, postId);

    const published = await publishMemberPost(decryptToken(creds.access_token_encrypted), creds.member_id, draft.text);
    const { error: updateError } = await getSupabase().from('daily_posts').update({ status: 'published', linkedin_post_urn: published.postUrn, published_at: new Date().toISOString(), linkedin_response: { status: published.status } }).eq('id', postId);
    if (updateError) throw updateError;
    await logEvent('publish','success',{ post_urn: published.postUrn, http_status: published.status }, postId);
    return NextResponse.json({ ok: true, published: true, topic: draft.topic, postUrn: published.postUrn, day });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown workflow error';
    if (postId) await getSupabase().from('daily_posts').update({ status: 'failed', error_message: message }).eq('id', postId);
    await logEvent('workflow','failed',{ message }, postId);
    await alertFailure('Daily workflow failed', message);
    console.error('Daily LinkedIn workflow failed', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
