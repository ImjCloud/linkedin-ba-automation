export default function Home() {
  return <main>
    <h1>LinkedIn BA Automation</h1>
    <p>Private deployment for daily, evidence-led Business Analyst thought leadership.</p>
    <h2>Setup checklist</h2>
    <ol>
      <li>Configure environment variables in Vercel.</li>
      <li>Apply the Supabase migration in <code>supabase/migrations</code>.</li>
      <li>Register the exact LinkedIn OAuth callback URL and enable Share on LinkedIn.</li>
      <li>Connect your LinkedIn profile through <a href="/api/oauth/linkedin/start">LinkedIn OAuth</a>.</li>
      <li>Check <a href="/api/health">health status</a>; run a protected cron test before enabling daily publishing.</li>
    </ol>
    <p><strong>Safety:</strong> publishing runs only when the content checks pass and a valid LinkedIn authorisation exists. Failures are logged and optionally sent to the configured alert webhook.</p>
  </main>;
}
