const required = ['APP_URL','LINKEDIN_CLIENT_ID','LINKEDIN_CLIENT_SECRET','LINKEDIN_REDIRECT_URI','OPENAI_API_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TOKEN_ENCRYPTION_KEY','CRON_SECRET'] as const;
export function assertEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
export function env(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}
