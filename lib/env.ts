const required = [
  'APP_URL',
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_CLIENT_SECRET',
  'LINKEDIN_REDIRECT_URI',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'GEMINI_API_KEY',
  'TOKEN_ENCRYPTION_KEY',
  'CRON_SECRET',
] as const;

export function assertEnv() {
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export function env(key: string): string {
  const value = process.env[key];
  if (!value?.trim()) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value.trim();
}
