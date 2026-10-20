import { getRedis } from '@/lib/redis';

export type LinkedInCredentials = {
  id: string;
  member_id: string;
  member_name: string | null;
  member_email: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: string;
  refresh_expires_at: string | null;
  scopes: string;
  connected_at: string;
  updated_at: string;
};

export type DailyPost = {
  id: string;
  scheduled_day: string;
  topic: string;
  text: string;
  sources: { title: string; url: string }[];
  content_hash: string;
  status: string;
  quality_checks: { passed: boolean; reasons: string[] };
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
};

export type PublishingEvent = {
  event_type: string;
  status: string;
  details: Record<string, unknown>;
  post_id: string | null;
  created_at: string;
};

const CREDENTIAL_KEY = 'linkedin:credentials:primary';
const POST_PREFIX = 'linkedin:daily:';
const EVENTS_KEY = 'linkedin:publishing:events';

export function dailyPostKey(day: string): string {
  return `${POST_PREFIX}${day}`;
}

export async function saveCredentials(
  credentials: LinkedInCredentials,
): Promise<void> {
  await getRedis().set(CREDENTIAL_KEY, credentials);
}

export async function getCredentials(): Promise<LinkedInCredentials | null> {
  return getRedis().get<LinkedInCredentials>(CREDENTIAL_KEY);
}

export async function getDailyPost(day: string): Promise<DailyPost | null> {
  return getRedis().get<DailyPost>(dailyPostKey(day));
}

export async function reserveDailyPost(
  day: string,
  post: DailyPost,
): Promise<boolean> {
  const result = await getRedis().set(dailyPostKey(day), post, { nx: true });
  return result === 'OK';
}

export async function updateDailyPost(
  day: string,
  updates: Partial<DailyPost>,
): Promise<void> {
  const redis = getRedis();
  const current = await redis.get<DailyPost>(dailyPostKey(day));

  if (!current) {
    throw new Error(`Daily post record for ${day} does not exist.`);
  }

  await redis.set(dailyPostKey(day), {
    ...current,
    ...updates,
    updated_at: new Date().toISOString(),
  });
}

export async function getRecentPublishingEvents(
  limit = 8,
): Promise<PublishingEvent[]> {
  const result = await getRedis().lrange<PublishingEvent>(
    EVENTS_KEY,
    0,
    Math.max(0, limit - 1),
  );

  return Array.isArray(result) ? result : [];
}

export async function logPublishingEvent(
  event_type: string,
  status: string,
  details: Record<string, unknown> = {},
  post_id: string | null = null,
): Promise<void> {
  const redis = getRedis();

  await redis.lpush(EVENTS_KEY, {
    event_type,
    status,
    details,
    post_id,
    created_at: new Date().toISOString(),
  });

  await redis.ltrim(EVENTS_KEY, 0, 999);
}

