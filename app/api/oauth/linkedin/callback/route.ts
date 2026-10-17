import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { verifyState } from '@/lib/crypto';
import { getLinkedInUser } from '@/lib/linkedin';
import { getSupabase } from '@/lib/supabase';
import { alertFailure } from '@/lib/alerts';
import { encryptToken } from '@/lib/token-vault';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const error = request.nextUrl.searchParams.get('error');
    if (error) throw new Error(`LinkedIn authorisation was denied: ${error}`);
    const code = request.nextUrl.searchParams.get('code');
    const stateParam = request.nextUrl.searchParams.get('state') ?? '';
    const cookieState = request.cookies.get('li_oauth_state')?.value ?? '';
    const [state, signature] = stateParam.split('.');
    const [cookieValue, cookieSignature] = cookieState.split('.');
    if (!code || !state || !signature || state !== cookieValue || signature !== cookieSignature || !verifyState(state, signature)) throw new Error('OAuth state validation failed. Restart the LinkedIn connection flow.');
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: env('LINKEDIN_REDIRECT_URI'), client_id: env('LINKEDIN_CLIENT_ID'), client_secret: env('LINKEDIN_CLIENT_SECRET') }),
      signal: AbortSignal.timeout(20000)
    });
    const tokenBody = await tokenResponse.text();
    if (!tokenResponse.ok) throw new Error(`LinkedIn token exchange failed (${tokenResponse.status}): ${tokenBody.slice(0,500)}`);
    const token = JSON.parse(tokenBody);
    const user = await getLinkedInUser(token.access_token);
    const { error: dbError } = await getSupabase().from('linkedin_credentials').upsert({
      id: 'primary', member_id: user.id, member_name: user.name || null, member_email: user.email || null,
      access_token_encrypted: encryptToken(token.access_token), refresh_token_encrypted: token.refresh_token ? encryptToken(token.refresh_token) : null,
      expires_at: new Date(Date.now() + Number(token.expires_in ?? 0) * 1000).toISOString(),
      refresh_expires_at: token.refresh_token_expires_in ? new Date(Date.now() + Number(token.refresh_token_expires_in) * 1000).toISOString() : null,
      scopes: 'openid profile w_member_social', connected_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (dbError) throw dbError;
    const response = NextResponse.redirect(new URL('/?linkedin=connected', env('APP_URL')));
    response.cookies.delete('li_oauth_state');
    return response;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown OAuth error';
    await alertFailure('LinkedIn connection failed', message);
    const response = NextResponse.redirect(new URL('/?linkedin=error', env('APP_URL')));
    response.cookies.delete('li_oauth_state');
    return response;
  }
}
