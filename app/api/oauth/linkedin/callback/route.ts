import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { verifyState } from '@/lib/crypto';
import { getLinkedInUser } from '@/lib/linkedin';
import { alertFailure } from '@/lib/alerts';
import { encryptToken } from '@/lib/token-vault';
import { saveCredentials } from '@/lib/redis-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const oauthError = request.nextUrl.searchParams.get('error');
    if (oauthError) {
      throw new Error('LinkedIn authorization was denied.');
    }

    const code = request.nextUrl.searchParams.get('code');
    const stateParam = request.nextUrl.searchParams.get('state') ?? '';
    const cookieState = request.cookies.get('li_oauth_state')?.value ?? '';

    const [state, signature] = stateParam.split('.');
    const [cookieValue, cookieSignature] = cookieState.split('.');

    if (
      !code ||
      !state ||
      !signature ||
      state !== cookieValue ||
      signature !== cookieSignature ||
      !verifyState(state, signature)
    ) {
      throw new Error(
        'OAuth state validation failed. Restart the LinkedIn connection flow.',
      );
    }

    const tokenResponse = await fetch(
      'https://www.linkedin.com/oauth/v2/accessToken',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: env('LINKEDIN_REDIRECT_URI'),
          client_id: env('LINKEDIN_CLIENT_ID'),
          client_secret: env('LINKEDIN_CLIENT_SECRET'),
        }),
        signal: AbortSignal.timeout(20000),
      },
    );

    if (!tokenResponse.ok) {
      throw new Error(
        `LinkedIn token exchange failed with HTTP ${tokenResponse.status}.`,
      );
    }

    const token = await tokenResponse.json() as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };

    if (
      !token.access_token ||
      !Number.isFinite(token.expires_in) ||
      Number(token.expires_in) <= 0
    ) {
      throw new Error('LinkedIn returned an invalid access-token response.');
    }

    const user = await getLinkedInUser(token.access_token);
    const now = new Date();

    await saveCredentials({
      id: 'primary',
      member_id: user.id,
      member_name: user.name || null,
      member_email: user.email || null,
      access_token_encrypted: encryptToken(token.access_token),
      refresh_token_encrypted: token.refresh_token
        ? encryptToken(token.refresh_token)
        : null,
      expires_at: new Date(
        now.getTime() + Number(token.expires_in) * 1000,
      ).toISOString(),
      refresh_expires_at:
        token.refresh_token_expires_in &&
        Number(token.refresh_token_expires_in) > 0
          ? new Date(
              now.getTime() +
                Number(token.refresh_token_expires_in) * 1000,
            ).toISOString()
          : null,
      scopes: 'openid profile w_member_social',
      connected_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    const response = NextResponse.redirect(
      new URL('/?linkedin=connected', env('APP_URL')),
    );
    response.cookies.delete('li_oauth_state');
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown OAuth error';

    try {
      await alertFailure('LinkedIn connection failed', message);
    } catch (alertError) {
      console.error(
        'Failed to send OAuth failure alert:',
        alertError instanceof Error ? alertError.message : 'Unknown error',
      );
    }

    console.error('LinkedIn OAuth callback failed:', message);

    const response = NextResponse.redirect(
      new URL('/?linkedin=error', env('APP_URL')),
    );
    response.cookies.delete('li_oauth_state');
    return response;
  }
}
