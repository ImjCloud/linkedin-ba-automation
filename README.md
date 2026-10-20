# LinkedIn BA Automation

A dedicated Next.js application for evidence-led Business Analyst thought leadership. It uses Gemini to generate draft content, Upstash Redis for persistent credentials and publishing records, and LinkedIn OAuth and the LinkedIn Posts API.

## Architecture

- Next.js deployed on Vercel
- Google Gemini for content generation and research grounding
- Upstash Redis for credentials, daily post records, and publishing events
- LinkedIn OAuth for profile authorisation
- Vercel Cron for scheduled execution
- Optional alert webhook for failures

## Environment variables

Configure these in your local `.env.local` file and deployment environment. Never commit secret values or share them in chat.

- `APP_URL`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_REDIRECT_URI`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (optional; defaults to `gemini-2.5-flash`)
- `TOKEN_ENCRYPTION_KEY` (64 hexadecimal characters)
- `CRON_SECRET`
- `ALERT_WEBHOOK_URL` (optional)

Use `.env.example` as the template for required settings.

## Local development

Install dependencies:

    npm ci

Run the development server:

    npm run dev

Check the application health endpoint:

    http://localhost:3000/api/health

Test Gemini draft generation through the protected test endpoint. This endpoint must use the configured cron secret and must not publish to LinkedIn:

    POST /api/test/gemini

Send the request with an `Authorization: Bearer <CRON_SECRET>` header. Keep the secret private.

## LinkedIn setup

1. Configure a LinkedIn application and the required sharing permissions.
2. Set the exact OAuth callback URL to match `LINKEDIN_REDIRECT_URI`.
3. Configure the environment variables.
4. Open `/api/oauth/linkedin/start` to begin authorisation.
5. Confirm that the health endpoint can reach Redis.

## Publishing safeguards

- Content must pass quality checks before publication.
- Daily post records are reserved to help prevent duplicate publication.
- Failed publication attempts require review rather than blind automatic retries.
- Alerts are optional and depend on `ALERT_WEBHOOK_URL`.
- The publishing cron endpoint can publish publicly. Do not invoke it during ordinary validation.

## Validation

Run:

    npx tsc --noEmit
    npm run lint
    npm run build

Review the staged Git files before pushing. Never commit `.env.local`, access tokens, API keys, or migration backups.
