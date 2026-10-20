import { NextRequest, NextResponse } from 'next/server';
import {
  createDraftSession,
  DRAFT_SESSION_COOKIE,
  DRAFT_SESSION_TTL_SECONDS,
  getDraftAccessSecret,
  verifyDraftPassword,
  verifyDraftSession,
} from '@/lib/draft-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const protocol = forwardedProto?.split(',')[0]?.trim()
    || (process.env.NODE_ENV === 'production' ? 'https' : 'http');

  if (!origin || !host) return false;

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

function sessionResponse(request: NextRequest) {
  const secret = getDraftAccessSecret();
  const token = request.cookies.get(DRAFT_SESSION_COOKIE)?.value;
  const authenticated = Boolean(
    secret && verifyDraftSession(token, secret),
  );

  return NextResponse.json(
    {
      ok: true,
      configured: Boolean(secret),
      authenticated,
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function GET(request: NextRequest) {
  return sessionResponse(request);
}

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) {
    return NextResponse.json(
      { ok: false, error: 'Request origin could not be verified.' },
      { status: 403 },
    );
  }

  const secret = getDraftAccessSecret();
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Draft access is not configured. Set DRAFTS_ACCESS_SECRET on the server.',
      },
      { status: 503 },
    );
  }

  let password: unknown;
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('password' in body)
    ) {
      throw new Error('Invalid request body.');
    }
    password = body.password;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Provide a valid access password.' },
      { status: 400 },
    );
  }

  if (!verifyDraftPassword(password, secret)) {
    return NextResponse.json(
      { ok: false, error: 'Access password is incorrect.' },
      { status: 401 },
    );
  }

  const response = NextResponse.json(
    { ok: true, authenticated: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );

  response.cookies.set(
    DRAFT_SESSION_COOKIE,
    createDraftSession(secret),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: DRAFT_SESSION_TTL_SECONDS,
    },
  );

  return response;
}

export async function DELETE(request: NextRequest) {
  if (!originAllowed(request)) {
    return NextResponse.json(
      { ok: false, error: 'Request origin could not be verified.' },
      { status: 403 },
    );
  }

  const response = NextResponse.json(
    { ok: true, authenticated: false },
    { headers: { 'Cache-Control': 'no-store' } },
  );

  response.cookies.set(DRAFT_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });

  return response;
}

