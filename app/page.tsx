import Link from 'next/link';
import DraftPreview from '@/components/draft-preview';
import {
  getDailyPost,
  getRecentPublishingEvents,
} from '@/lib/redis-store';
import { getRedis } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function lagosDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function Status({
  value,
  good = false,
}: {
  value: string;
  good?: boolean;
}) {
  return (
    <span className={`status ${good ? 'status-good' : 'status-muted'}`}>
      <span className="status-dot" />
      {value}
    </span>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon-box" aria-hidden="true">{children}</span>;
}

export default async function Home() {
  const day = lagosDay();
  let redisOk = false;
  let post: Awaited<ReturnType<typeof getDailyPost>> = null;
  let events: Awaited<ReturnType<typeof getRecentPublishingEvents>> = [];
  let loadError = false;

  try {
    const redis = getRedis();
    redisOk = (await redis.ping()) === 'PONG';

    if (redisOk) {
      [post, events] = await Promise.all([
        getDailyPost(day),
        getRecentPublishingEvents(8),
      ]);
    }
  } catch {
    loadError = true;
    redisOk = false;
  }

  const envChecks = [
    ['Upstash Redis URL', Boolean(process.env.UPSTASH_REDIS_REST_URL)],
    ['Upstash Redis token', Boolean(process.env.UPSTASH_REDIS_REST_TOKEN)],
    ['Gemini API key', Boolean(process.env.GEMINI_API_KEY)],
    ['Encryption key', /^[0-9a-fA-F]{64}$/.test(process.env.TOKEN_ENCRYPTION_KEY ?? '')],
    ['Cron secret', Boolean(process.env.CRON_SECRET)],
    ['LinkedIn OAuth client', Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)],
  ];

  const readyCount = envChecks.filter((item) => item[1]).length;
  const qualityPassed = post?.quality_checks?.passed === true;
  const published = post?.status === 'published';
  const blocked = post?.status === 'blocked' || post?.status === 'failed';
  const todayStatus = post?.status ?? 'No run recorded';

  const recentEvents = events.map((event, index) => ({
    id: `${event.created_at}-${index}`,
    type: String(event.event_type || 'Automation event'),
    status: String(event.status || 'unknown'),
    time: event.created_at
      ? new Date(event.created_at).toLocaleString('en-GB', {
          timeZone: 'Africa/Lagos',
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : 'Time unavailable',
  }));

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">in</span>
          <span>
            <strong>LinkedIn BA</strong>
            <small>Automation</small>
          </span>
        </Link>

        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><span>⌂</span> Overview</a>
          <a className="nav-item" href="#activity"><span>◷</span> Activity</a>
          <a className="nav-item" href="#content"><span>▤</span> Content queue</a>
          <a className="nav-item" href="#health"><span>⌁</span> System health</a>
          <a className="nav-item" href="#setup"><span>⚙</span> Setup checklist</a>
        </nav>

        <div className="sidebar-bottom">
          <Status value={redisOk ? 'Redis online' : 'Redis unavailable'} good={redisOk} />
          <small>Private automation · v1</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">CONTROL CENTRE</p>
            <h1>Automation dashboard</h1>
            <p className="subtitle">
              Monitor your Business Analyst thought-leadership workflow.
            </p>
          </div>
          <div className="topbar-meta">
            <Status value="Dashboard live" good />
            <span className="date-label">{day} · Africa/Lagos</span>
          </div>
        </header>

        {loadError && (
          <div className="alert-banner">
            Redis could not be reached. Check the server logs and local environment configuration.
          </div>
        )}

        <section id="overview" className="metric-grid" aria-label="Overview metrics">
          <article className="metric-card">
            <Icon>▤</Icon>
            <p>Today&apos;s record</p>
            <strong className="metric-value">{post ? '1' : '0'}</strong>
            <span className="metric-note">Lagos calendar day</span>
          </article>
          <article className="metric-card">
            <Icon>✓</Icon>
            <p>Quality checks</p>
            <strong className="metric-value">{post ? (qualityPassed ? 'Passed' : 'Review') : '—'}</strong>
            <span className="metric-note">{post ? 'Based on today&apos;s stored draft' : 'No draft recorded today'}</span>
          </article>
          <article className="metric-card">
            <Icon>↗</Icon>
            <p>Publication status</p>
            <strong className="metric-value metric-status-text">
              {published ? 'Published' : blocked ? 'Needs review' : 'Not confirmed'}
            </strong>
            <span className="metric-note">No inferred success counts</span>
          </article>
          <article className="metric-card">
            <Icon>⚙</Icon>
            <p>Configuration</p>
            <strong className="metric-value">{readyCount}/{envChecks.length}</strong>
            <span className="metric-note">Required settings present</span>
          </article>
        </section>

        <section className="main-grid">
          <div className="panel activity-panel" id="activity">
            <div className="panel-heading">
              <div>
                <h2>Recent activity</h2>
                <p>Latest events stored by the automation</p>
              </div>
              <span className="small-count">{recentEvents.length} events</span>
            </div>

            {recentEvents.length > 0 ? (
              <div className="activity-list">
                {recentEvents.map((event) => (
                  <div className="activity-row" key={event.id}>
                    <span className={`activity-symbol ${event.status.toLowerCase() === 'success' || event.status.toLowerCase() === 'published' ? 'symbol-good' : 'symbol-neutral'}`}>
                      {event.status.toLowerCase() === 'success' || event.status.toLowerCase() === 'published' ? '✓' : '•'}
                    </span>
                    <div className="activity-copy">
                      <strong>{event.type.replace(/[_-]/g, ' ')}</strong>
                      <small>{event.time}</small>
                    </div>
                    <span className="event-status">{event.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-icon">◷</span>
                <strong>No activity records yet</strong>
                <p>Events will appear here when the automation writes them to Redis.</p>
              </div>
            )}
          </div>

          <div className="panel health-panel" id="health">
            <div className="panel-heading">
              <div>
                <h2>System health</h2>
                <p>Known status, not assumptions</p>
              </div>
            </div>
            <div className="health-row">
              <span className="health-icon">▤</span>
              <div className="health-copy">
                <strong>Upstash Redis</strong>
                <small>Live connection check</small>
              </div>
              <Status value={redisOk ? 'Healthy' : 'Offline'} good={redisOk} />
            </div>
            <div className="health-row">
              <span className="health-icon">✦</span>
              <div className="health-copy">
                <strong>Gemini generation</strong>
                <small>Configured, not live-tested here</small>
              </div>
              <Status value={process.env.GEMINI_API_KEY ? 'Configured' : 'Missing'} good={Boolean(process.env.GEMINI_API_KEY)} />
            </div>
            <div className="health-row">
              <span className="health-icon">in</span>
              <div className="health-copy">
                <strong>LinkedIn OAuth</strong>
                <small>Credentials and publishing not tested</small>
              </div>
              <Status value="Unverified" />
            </div>
            <div className="health-row">
              <span className="health-icon">◷</span>
              <div className="health-copy">
                <strong>Scheduled run</strong>
                <small>Vercel cron configuration</small>
              </div>
              <Status value="Not verified" />
            </div>
            <div className="safety-note">
              <strong>Publishing safety</strong>
              <p>This dashboard does not trigger publishing. A health check alone never publishes a post.</p>
            </div>
          </div>
        </section>

        <DraftPreview />

        <section className="panel content-panel" id="content">
          <div className="panel-heading">
            <div>
              <h2>Today&apos;s content record</h2>
              <p>Stored status for {day}</p>
            </div>
            <span className={`pill ${published ? 'pill-green' : 'pill-neutral'}`}>{todayStatus}</span>
          </div>

          {post ? (
            <>
              <div className="content-details">
                <div>
                  <span className="field-label">Topic</span>
                  <strong>{post.topic || 'Topic not recorded'}</strong>
                </div>
                <div>
                  <span className="field-label">Quality gate</span>
                  <strong>{qualityPassed ? 'Passed' : 'Not passed'}</strong>
                </div>
                <div>
                  <span className="field-label">Sources</span>
                  <strong>{post.sources?.length ?? 0} recorded</strong>
                </div>
              </div>
              {post.quality_checks?.reasons?.length > 0 && (
                <div className="quality-warning">
                  <strong>Quality issues to review</strong>
                  <ul>
                    {post.quality_checks.reasons.map((reason, index) => (
                      <li key={`${reason}-${index}`}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              <details className="draft-details">
                <summary>Inspect draft text</summary>
                <p className="draft-text">{post.text}</p>
                {post.sources?.length > 0 && (
                  <ul className="source-list">
                    {post.sources.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </>
          ) : (
            <div className="empty-state compact-empty">
              <strong>No daily post record found</strong>
              <p>That is normal before the first draft has been generated. No post has been created by this dashboard.</p>
            </div>
          )}
        </section>

        <section className="panel setup-panel" id="setup">
          <div className="panel-heading">
            <div>
              <h2>Configuration readiness</h2>
              <p>Only presence and format are checked here—not whether provider credentials work.</p>
            </div>
            <span className="small-count">{readyCount} of {envChecks.length}</span>
          </div>
          <div className="setup-grid">
            {envChecks.map(([label, ready]) => (
              <div className="setup-item" key={String(label)}>
                <span className={`setup-check ${ready ? 'setup-ready' : ''}`}>{ready ? '✓' : '!'}</span>
                <div>
                  <strong>{label}</strong>
                  <small>{ready ? 'Present' : 'Missing or invalid format'}</small>
                </div>
              </div>
            ))}
          </div>
          <p className="setup-footnote">
            Never put secrets in browser code or display their values on this page.
          </p>
        </section>

        <footer className="footer">
          <span>LinkedIn BA Automation</span>
          <span>Dashboard data is read from server-side Redis records.</span>
        </footer>
      </section>
    </main>
  );
}
