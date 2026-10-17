# LinkedIn BA Automation (starter implementation)

A dedicated Next.js/Vercel app for a daily, source-supported Business Analyst thought-leadership post. It uses LinkedIn's official OAuth and Posts API, Supabase for persistent credentials/logs, and OpenAI Responses API with web search for content generation.

## Current state and honest limitations

This is a starter implementation, **not a live publishing system yet**. It has not been deployed, connected to a LinkedIn developer app, or tested against a real LinkedIn account. Do not claim it is live until OAuth succeeds and an end-to-end publishing test returns a LinkedIn post URN.

- Vercel Cron runs at `0 8 * * *` UTC = 09:00 Africa/Lagos (WAT). Cron timing depends on Vercel plan availability.
- The LinkedIn API does not offer a future publication time in the post creation payload; Vercel Cron is the scheduler.
- A LinkedIn app needs the self-service **Share on LinkedIn** product and member permission `w_member_social`.
- Access tokens may expire. This starter stops and alerts rather than publishing with an expired token. Refresh-token availability depends on LinkedIn's token grant; reconnect if no refresh token is issued.
- Quality checks are deterministic guardrails, not a guarantee of truth. Review source quality and test carefully before enabling production auto-publishing.
- There is no manual approval gate by design; failed checks block publication and send an alert if `ALERT_WEBHOOK_URL` is configured.
- The app writes secrets only server-side. Never put service-role keys, client secrets, cron secrets, or access tokens in `NEXT_PUBLIC_*` variables or source control.

## 1. Create external resources

1. Create a **new dedicated Supabase project**. Do not reuse unrelated projects or paste keys into chat.
2. In Supabase SQL Editor, run `supabase/migrations/0001_initial.sql`.
3. Create a LinkedIn app at <https://www.linkedin.com/developers/>. Add the exact callback URL:
   `https://YOUR-DEPLOYMENT-DOMAIN/api/oauth/linkedin/callback`
4. Add the **Share on LinkedIn** product to the app. This provides `w_member_social`. The app's OAuth consent request also asks for `openid profile` to identify the member.
5. Create an OpenAI API key with access to the Responses API and web search.
6. Create a private GitHub repository named `linkedin-ba-automation`, then push this project.

## 2. Deploy to Vercel

Import the new repository as a separate Vercel project. Add all environment variables from `.env.example` in Vercel Project Settings. Use the deployed HTTPS URL for `APP_URL` and `LINKEDIN_REDIRECT_URI`. Generate a unique random `CRON_SECRET` of at least 32 characters. Configure `ALERT_WEBHOOK_URL` to a private Slack/Teams webhook if alerts are desired.

Environment variables required:

- `APP_URL`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_REDIRECT_URI`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default `gpt-5`; set to a model available to your API project)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TOKEN_ENCRYPTION_KEY` (generate with `openssl rand -hex 32`; store only in Vercel and a secure password manager)
- `CRON_SECRET`
- optional `ALERT_WEBHOOK_URL`
- optional `LINKEDIN_API_VERSION` (defaults to `202610`; check LinkedIn's current supported version before deployment)

## 3. Connect the LinkedIn profile

Visit `https://YOUR-DEPLOYMENT-DOMAIN/api/oauth/linkedin/start` while logged into your app deployment and approve the LinkedIn permissions. The callback stores the token in the private Supabase table. The service-role key is server-only. Revoke app access in LinkedIn settings if you want to disconnect.

## 4. Verify before enabling automatic publishing

1. Open `/api/health`; it should report database reachable.
2. Verify the `linkedin_credentials` row exists in Supabase without exposing the access token.
3. Call the protected cron endpoint manually from a secure terminal using `Authorization: Bearer $CRON_SECRET`. A successful run publishes a real public LinkedIn post; do this only when ready to publish.
4. Verify the response contains `published: true` and a `postUrn`, then confirm the post appears on your LinkedIn profile and the database records status `published`.
5. Inspect `publishing_events` for quality-check and publication records.
6. Ensure the Vercel Cron is active and test a failure alert before relying on the daily run.

Do not use a GET request to the cron endpoint without its secret. Do not use a production test unless you consent to a public test post.

## Security and operational hardening before production

- Restrict access to the app's status page if it will be public.
- OAuth access and refresh tokens are encrypted at the application layer with AES-256-GCM before storage. Back up `TOKEN_ENCRYPTION_KEY` securely; rotating it requires re-encrypting stored tokens or reconnecting LinkedIn.
- Add retry/reconciliation logic for uncertain network timeouts. A request may reach LinkedIn even if the client does not receive its response; inspect logs before retrying to avoid duplicates.
- Add content-hash duplicate checks across prior days, not only one-post-per-day uniqueness.
- Verify LinkedIn API version availability and OAuth token lifetime before production.
- Add monitoring and a periodic token-expiry alert. The current implementation fails closed on expired tokens.
- Keep all generated source URLs and audit records; never fabricate personal achievements or business metrics.
