import { NextResponse } from 'next/server';
import { validateDraft } from '@/lib/content-quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { ok: false, error: 'Preview is available only in development.' },
      { status: 404 },
    );
  }

  const topic = 'Acceptance criteria that reduce rework';

  const text = [
    'A requirement can look complete on paper and still leave a delivery team guessing.',
    '',
    'One practical way to reduce that ambiguity is to make acceptance criteria observable and testable before development begins.',
    '',
    'For example, instead of writing "the user can reset a password easily", clarify the expected behaviour:',
    '- The user can request a reset using their registered email address.',
    '- The system displays a neutral confirmation message.',
    '- The reset link expires after the agreed period.',
    '- An expired or invalid link produces a clear recovery path.',
    '- The team can verify these outcomes during testing.',
    '',
    'As a Business Analyst, I would validate these conditions with the relevant stakeholders, confirm exceptional scenarios, and make sure the QA team can test the expected outcomes without interpreting the requirement differently.',
    '',
    'The goal is not to write more documentation for its own sake. It is to reduce assumptions, make scope visible, and give business, engineering, and QA a shared definition of done.',
    '',
    'A useful question to ask during refinement is: "What observable result would prove this requirement works as intended?"',
    '',
    'What technique has helped your team make acceptance criteria clearer?',
  ].join('\n');

  const sources = [
    {
      title: 'Agile Alliance: Acceptance Criteria',
      url: 'https://www.agilealliance.org/glossary/acceptance/',
    },
    {
      title: 'Atlassian: User Stories',
      url: 'https://www.atlassian.com/agile/project-management/user-stories',
    },
  ];

  return NextResponse.json({
    ok: true,
    mode: 'mock',
    published: false,
    topic,
    text,
    sources,
    checks: validateDraft(topic, text, sources),
  });
}
