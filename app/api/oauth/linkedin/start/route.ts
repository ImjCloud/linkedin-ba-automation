import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { randomState, signState } from '@/lib/crypto';
export const runtime = 'nodejs';
export async function GET() {
  const state = randomState();
  const signature = signState(state);
  const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env('LINKEDIN_CLIENT_ID'));
  url.searchParams.set('redirect_uri', env('LINKEDIN_REDIRECT_URI'));
  url.searchParams.set('state', `${state}.${signature}`);
  url.searchParams.set('scope', 'openid profile w_member_social');
  const response = NextResponse.redirect(url);
  response.cookies.set('li_oauth_state', `${state}.${signature}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 });
  return response;
}
