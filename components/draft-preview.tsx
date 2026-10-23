'use client';

import { useEffect, useMemo, useState } from 'react';
import { validateDraft } from '@/lib/content-quality';

type ReviewStatus =
  | 'Not reviewed'
  | 'Approved locally'
  | 'Returned for revision';

type DraftSource = { title: string; url: string };

type DraftData = {
  id?: string;
  mode: 'mock' | 'saved';
  published: false;
  topic: string;
  text: string;
  sources: DraftSource[];
  checks: { passed: boolean; reasons: string[] };
  reviewStatus: ReviewStatus;
  created_at?: string;
  updated_at?: string;
};

type SavedDraft = Omit<DraftData, 'mode' | 'published'> & {
  id: string;
  created_at: string;
  updated_at: string;
};

const SAVE_ENABLED = true;

export default function DraftPreview() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState('');
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<DraftData | null>(null);
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [reviewStatus, setReviewStatus] =
    useState<ReviewStatus>('Not reviewed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const checks = useMemo(
    () => validateDraft(topic, text, draft?.sources ?? []),
    [topic, text, draft?.sources],
  );

  async function refreshSavedDrafts() {
    const response = await fetch('/api/drafts', { cache: 'no-store' });
    const data = await response.json() as {
      ok?: boolean;
      error?: string;
      drafts?: SavedDraft[];
    };

    if (!response.ok || !data.ok || !Array.isArray(data.drafts)) {
      throw new Error(data.error || 'Saved drafts could not be loaded.');
    }

    setDrafts(data.drafts);
  }

  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const response = await fetch('/api/drafts/session', {
          cache: 'no-store',
        });
        const data = await response.json() as {
          ok?: boolean;
          configured?: boolean;
          authenticated?: boolean;
        };

        if (!response.ok || !data.ok) {
          throw new Error('Could not check draft access.');
        }

        if (!active) return;
        setConfigured(Boolean(data.configured));
        setAuthenticated(Boolean(data.authenticated));

        if (data.authenticated) {
          try {
            await refreshSavedDrafts();
          } catch (cause) {
            if (active) {
              setError(cause instanceof Error ? cause.message : 'Could not load saved drafts.');
            }
          }
        }
      } catch {
        if (active) setError('Could not check draft access. Confirm the local server is running.');
      } finally {
        if (active) setCheckingSession(false);
      }
    }

    void checkSession();
    return () => { active = false; };
  }, []);

  async function signIn() {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch('/api/drafts/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        cache: 'no-store',
      });
      const data = await response.json() as {
        ok?: boolean;
        error?: string;
        authenticated?: boolean;
      };

      if (!response.ok || !data.authenticated) {
        throw new Error(data.error || 'Sign-in failed.');
      }

      setPassword('');
      setAuthenticated(true);
      await refreshSavedDrafts();
      setNotice('Signed in. Draft generation and Redis draft storage are available. Publishing remains disconnected.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch('/api/drafts/session', {
        method: 'DELETE',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Could not sign out.');

      setAuthenticated(false);
      setDrafts([]);
      setSelectedId('');
      setDraft(null);
      setTopic('');
      setText('');
      setReviewStatus('Not reviewed');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-out failed.');
    } finally {
      setBusy(false);
    }
  }

  async function generateLiveDraft() {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch('/api/drafts/generate', {
        method: 'POST',
        cache: 'no-store',
      });
      const data = await response.json() as {
        ok?: boolean;
        error?: string;
        published?: boolean;
        draft?: SavedDraft;
      };

      if (!response.ok || !data.ok || !data.draft || data.published !== false) {
        throw new Error(data.error || 'Draft generation failed.');
      }

      const saved = data.draft;
      setDraft({ ...saved, mode: 'saved', published: false });
      setTopic(saved.topic);
      setText(saved.text);
      setReviewStatus('Not reviewed');
      setSelectedId(saved.id);
      await refreshSavedDrafts();
      setNotice('Gemini generated a draft and saved it to Redis. It has not been approved or published.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Draft generation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview() {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch('/api/test/draft-preview', {
        cache: 'no-store',
      });
      const data = await response.json() as {
        ok?: boolean;
        error?: string;
        mode?: string;
        published?: boolean;
        topic?: string;
        text?: string;
        sources?: DraftSource[];
        checks?: { passed: boolean; reasons: string[] };
      };

      if (
        !response.ok || !data.ok || data.mode !== 'mock' ||
        typeof data.topic !== 'string' || typeof data.text !== 'string' ||
        !Array.isArray(data.sources)
      ) {
        throw new Error(data.error || 'The sample could not be loaded.');
      }

      setDraft({
        mode: 'mock',
        published: false,
        topic: data.topic,
        text: data.text,
        sources: data.sources,
        checks: data.checks ?? { passed: false, reasons: [] },
        reviewStatus: 'Not reviewed',
      });
      setTopic(data.topic);
      setText(data.text);
      setReviewStatus('Not reviewed');
      setSelectedId('');
      setNotice('Sample loaded. Changes remain local until saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sample unavailable.');
    } finally {
      setBusy(false);
    }
  }

  function openSavedDraft(id: string) {
    setSelectedId(id);
    setError('');
    setNotice('');

    const saved = drafts.find((item) => item.id === id);
    if (!saved) return;

    setDraft({
      ...saved,
      mode: 'saved',
      published: false,
    });
    setTopic(saved.topic);
    setText(saved.text);
    setReviewStatus(saved.reviewStatus);
    setNotice('Saved draft loaded. Your edits are local until saved.');
  }

  function updateTopic(value: string) {
    setTopic(value);
    setReviewStatus('Not reviewed');
  }

  function updateText(value: string) {
    setText(value);
    setReviewStatus('Not reviewed');
  }

  async function saveDraft() {
    if (!SAVE_ENABLED || !draft) return;

    setBusy(true);
    setError('');
    setNotice('');

    try {
      const payload = {
        topic,
        text,
        sources: draft.sources,
        reviewStatus,
      };
      const response = await fetch(
        draft.id ? `/api/drafts/${draft.id}` : '/api/drafts',
        {
          method: draft.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        },
      );
      const data = await response.json() as {
        ok?: boolean;
        error?: string;
        draft?: SavedDraft;
      };

      if (!response.ok || !data.ok || !data.draft) {
        throw new Error(data.error || 'Could not save the draft.');
      }

      const saved = data.draft;
      setDraft({ ...saved, mode: 'saved', published: false });
      setSelectedId(saved.id);
      setReviewStatus(saved.reviewStatus);
      await refreshSavedDrafts();
      setNotice('Draft saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the draft.');
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession) {
    return (
      <section className="panel draft-preview-panel">
        <h2>Draft workspace</h2>
        <p>Checking secure access…</p>
      </section>
    );
  }

  return (
    <section className="panel draft-preview-panel" id="draft-preview">
      <div className="panel-heading">
        <div>
          <h2>Draft workspace</h2>
          <p>Review, edit and manage Business Analyst post drafts.</p>
        </div>
        <span className="pill pill-neutral">Draft only</span>
      </div>

      {!authenticated ? (
        <div className="draft-access-panel">
          <h3>Secure draft access</h3>
          <p>Sign in with the draft-access password configured on this server.</p>

          {configured === false && (
            <p className="preview-error">
              Draft access is not configured. Check DRAFTS_ACCESS_SECRET in your local environment and restart the development server.
            </p>
          )}

          <label className="draft-field">
            <span className="field-label">Access password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              aria-label="Draft access password"
              disabled={busy || configured === false}
            />
          </label>
          <div className="draft-preview-actions">
            <button
              className="preview-button"
              type="button"
              onClick={signIn}
              disabled={busy || !password || configured === false}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="draft-preview-safety">
            <strong>Protected, draft-only workspace</strong>
            <span>Generate uses Gemini and saves the result to Redis for review. It never publishes to LinkedIn. Every generated draft starts as Not reviewed; local approval is not permission to publish.</span>
          </div>

          <div className="draft-preview-actions">
            <button
              className="preview-secondary-button"
              type="button"
              onClick={signOut}
              disabled={busy}
            >
              Sign out
            </button>
            <button
              className="preview-button"
              type="button"
              onClick={generateLiveDraft}
              disabled={busy}
            >
              {busy ? 'Working…' : 'Generate draft with Gemini'}
            </button>
            <button
              className="preview-secondary-button"
              type="button"
              onClick={loadPreview}
              disabled={busy}
            >
              Load sample draft
            </button>
            <button
              className="preview-secondary-button"
              type="button"
              onClick={() => void refreshSavedDrafts().catch((cause) =>
                setError(cause instanceof Error ? cause.message : 'Could not load drafts.'))}
              disabled={busy}
            >
              Refresh saved drafts
            </button>
          </div>

          <label className="draft-field draft-saved-picker">
            <span className="field-label">Saved drafts ({drafts.length})</span>
            <select
              value={selectedId}
              onChange={(event) => openSavedDraft(event.target.value)}
              disabled={drafts.length === 0 || busy}
            >
              <option value="">Choose a saved draft…</option>
              {drafts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.topic} — {new Date(item.updated_at).toLocaleString()}
                </option>
              ))}
            </select>
          </label>

          {draft && (
            <>
              <div className="draft-preview-actions">
                <span className="preview-meta">
                  {draft.mode === 'saved' ? 'Saved draft' : 'Unsaved sample'}
                  {' · '}{text.length} characters
                  {' · '}{draft.sources.length} reference sources
                </span>
              </div>

              <div className="draft-editor-fields">
                <label className="draft-field">
                  <span className="field-label">Post topic</span>
                  <input
                    value={topic}
                    onChange={(event) => updateTopic(event.target.value)}
                    maxLength={160}
                    aria-label="Draft topic"
                  />
                </label>

                <label className="draft-field">
                  <span className="field-label">LinkedIn post text</span>
                  <textarea
                    value={text}
                    onChange={(event) => updateText(event.target.value)}
                    rows={14}
                    maxLength={3500}
                    aria-label="Draft post text"
                  />
                </label>

                <div className="draft-editor-meta">
                  <span>{text.length} / 3000 recommended maximum characters</span>
                  <span>{text.trim().length < 500 || text.trim().length > 3000 ? 'Outside length requirement' : 'Length requirement met'}</span>
                </div>
              </div>

              <div className="preview-result-heading">
                <div>
                  <span className="field-label">Current validation</span>
                  <h3>{checks.passed ? 'All configured checks passed' : 'Review required'}</h3>
                </div>
                <span className={`pill ${checks.passed ? 'pill-green' : 'pill-neutral'}`}>
                  {checks.passed ? 'Passed' : `${checks.reasons.length} issue(s)`}
                </span>
              </div>

              {!checks.passed && (
                <div className="quality-warning">
                  <strong>Resolve these issues before approval</strong>
                  <ul>
                    {checks.reasons.map((reason, index) => (
                      <li key={`${reason}-${index}`}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              {checks.passed && (
                <p className="draft-check-success">
                  The current topic, text and reference sources pass the configured checks.
                </p>
              )}

              <div className="preview-sources">
                <h3>Reference sources</h3>
                <ul className="source-list">
                  {draft.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer">
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="draft-review-panel">
                <div>
                  <span className="field-label">Review status</span>
                  <p className="draft-review-status" aria-live="polite">{reviewStatus}</p>
                  <p className="preview-meta">
                    Review changes are local until a draft is saved.
                  </p>
                </div>
                <div className="draft-review-actions">
                  <button
                    className="preview-button"
                    type="button"
                    disabled={!checks.passed}
                    onClick={() => setReviewStatus('Approved locally')}
                  >
                    Approve locally
                  </button>
                  <button
                    className="preview-secondary-button"
                    type="button"
                    onClick={() => setReviewStatus('Returned for revision')}
                  >
                    Return for revision
                  </button>
                </div>
              </div>

              <div className="draft-save-panel">
                <button
                  className="preview-button"
                  type="button"
                  onClick={saveDraft}
                  disabled={!SAVE_ENABLED || busy}
                  title="Saving will be enabled after explicit approval of the first Redis write."
                >
                  {draft.id ? 'Update saved draft' : 'Save as new draft'}
                </button>
                <p className="preview-meta">
                  {SAVE_ENABLED
                    ? 'Saving writes draft content and review status to Redis. It does not publish.'
                    : 'Saving is currently locked.'}
                </p>
              </div>

              <p className="preview-disclaimer">
                Workspace mode: {draft.mode}. Published: No. Local approval is not permission to publish.
              </p>
            </>
          )}
        </>
      )}

      {error && <p className="preview-error" role="alert">{error}</p>}
      {notice && <p className="draft-notice" role="status">{notice}</p>}
    </section>
  );
}
