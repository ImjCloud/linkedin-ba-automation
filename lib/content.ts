import { GoogleGenAI } from '@google/genai';
import { env } from '@/lib/env';
import { validateDraft } from '@/lib/content-quality';

export type Draft = {
  text: string;
  topic: string;
  sources: { title: string; url: string }[];
  checks: { passed: boolean; reasons: string[] };
};

export async function generateDraft(): Promise<Draft> {
  const ai = new GoogleGenAI({ apiKey: env('GEMINI_API_KEY') });
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

  const prompt = `
Write one original, evidence-led LinkedIn post in the voice of a thoughtful,
practical Business Analyst based in Nigeria who is building a career in digital
products, workflow automation and delivery, and wants to engage UK recruiters,
product leaders and delivery managers.

PERSONALITY AND HUMAN VOICE
- Sound like a real practitioner sharing a useful observation with peers, not
  a corporate blog, textbook, press release or AI-generated thought-leadership
  template.
- Be warm but professionally direct. Use plain, natural English, contractions
  where they fit, and varied sentence lengths.
- Start with a specific tension, small operational detail, trade-off or
  question that a BA or delivery team could genuinely recognise. Avoid generic
  openings such as "In today's fast-paced world", "It is important to note",
  and "X is more than just Y".
- Explain why the issue matters to people doing the work: analysts, operations,
  customers, product owners or delivery teams. Use concrete examples instead
  of stacking abstract business phrases.
- Bring in a distinct BA point of view: what to ask in discovery, which process
  gap to map, what requirement or acceptance criterion to clarify, or what
  evidence to inspect. Prefer one useful insight explained clearly over a list
  of obvious tips.
- Make the post feel personal through perspective and judgement, not invented
  autobiography. Do not claim the author personally led a project, worked with
  a named client, observed a specific incident, delivered a result or used a
  tool unless that information was explicitly supplied in the prompt.
- Avoid repetitive AI patterns: over-polished transitions, predictable
  "problem / solution / impact" headings, excessive em dashes, inflated claims,
  buzzword-heavy sentences, repeated restatements and generic closing lessons.
- Do not force a personal anecdote. If there is no verified personal detail,
  use an honest practitioner observation or a realistic, clearly hypothetical
  example instead.

RESEARCH AND SUBSTANCE
Use Google Search to research a current, relevant business or technology issue.
Rotate themes such as AI governance, cybersecurity, data quality, workflow
automation, digital identity, fintech, cloud resilience, accessibility, product
discovery, change adoption and operational risk.

Build the post around one clear idea. Explain the practical business or user
problem, who feels the impact, and one specific BA intervention. Where useful,
name a metric to investigate and explain what it reveals; do not imply that a
metric has improved unless credible evidence supports that claim. Distinguish
verified facts from interpretation or forecasts. Never invent statistics,
results, sources, personal experience, clients or credentials.

STYLE AND FORMAT
- Aim for 150-250 words, using a natural LinkedIn rhythm and readable short
  paragraphs.
- Use a short numbered or bulleted list only when it genuinely improves
  clarity; do not make every post a listicle.
- End with one specific, open question that invites experienced peers to share
  how they approach the issue. Avoid engagement bait.
- Add 3-5 relevant hashtags, not generic hashtag stuffing.
- Before returning, silently revise once: remove robotic or generic phrases,
  replace abstractions with concrete language, check that the point of view is
  distinctive, and make sure every claim is supportable.

Return valid JSON only with:
{"topic":"...","text":"..."}
Do not include source URLs in the JSON. Sources will be collected separately
from Google's grounding metadata.
`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const raw = response.text?.trim() ?? '';
  if (!raw) throw new Error('Gemini returned an empty response.');

  const cleaned = raw
    .replace(/^\`\`\`(?:json)?\\s*/i, '')
    .replace(/\\s*\`\`\`$/, '')
    .trim();

  let parsed: { topic?: unknown; text?: unknown };

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Gemini response was not valid JSON.');
  }

  const text = String(parsed.text ?? '').trim();
  const topic = String(parsed.topic ?? '').trim();

  const groundingChunks =
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

  const sources: { title: string; url: string }[] = [];
  for (const chunk of groundingChunks) {
    const web = chunk.web;
    const url = web?.uri?.trim() ?? '';
    const title = web?.title?.trim() || url;

    if (
      /^https:\/\//i.test(url) &&
      title &&
      !sources.some((source) => source.url === url)
    ) {
      sources.push({ title, url });
    }
  }

  const checks = validateDraft(topic, text, sources);

  return {
    topic,
    text,
    sources,
    checks,
  };
}
