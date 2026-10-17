import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const { error } = await getSupabase().from('publishing_events').select('id').limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, database: 'reachable', linkedin: 'not checked here', note: 'This endpoint does not reveal secrets or test publication.' });
  } catch (error) {
    return NextResponse.json({ ok: false, database: 'unavailable', error: error instanceof Error ? error.message : 'unknown error' }, { status: 503 });
  }
}
