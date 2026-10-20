import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Validate configuration without returning any secret values.
    env('UPSTASH_REDIS_REST_URL');
    env('UPSTASH_REDIS_REST_TOKEN');

    const redis = getRedis();
    const result = await redis.ping();

    if (result !== 'PONG') {
      throw new Error('Redis did not return the expected health-check response.');
    }

    return NextResponse.json({
      ok: true,
      database: 'reachable',
      provider: 'upstash-redis',
      linkedin: 'not checked',
      publishing: 'not triggered',
    });
  } catch (error) {
    console.error(
      'Health check failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );

    return NextResponse.json(
      {
        ok: false,
        database: 'unavailable',
        publishing: 'not triggered',
        error: 'Redis health check failed. Check server logs and environment configuration.',
      },
      { status: 503 },
    );
  }
}
