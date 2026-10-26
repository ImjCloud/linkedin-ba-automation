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
Create one original, practical LinkedIn post for a Nigeria-based Business
Analyst targeting UK recruiters, Business Analyst hiring teams, product
leaders and delivery managers.

Choose one focused topic. Prioritise practical Business Analysis work:
requirements elicitation, stakeholder alignment, user stories, acceptance
criteria, process mapping, workflow automation, UAT, data quality, change
adoption, product discovery, accessibility, AI governance or operational risk.

Explain a recognisable business or delivery problem, who it affects, the
underlying process or requirements issue, and a practical intervention a
Business Analyst could use. Where appropriate, identify a KPI that a team
could measure to evaluate the change. Do not invent numerical improvements,
research findings, statistics, client details, personal work history or
project outcomes. Present proposed metrics as measures to investigate, not
results already achieved.

Use specific, useful language rather than generic motivational advice.
Vary the opening hook and structure between posts. Possible structures include
a short scenario, a common delivery mistake, a practical checklist, a trade-off
or a lesson about requirements and stakeholder decisions. Do not force every
post into the same structure.

Use natural professional English, 150-250 words, a meaningful discussion
question and 3-5 relevant hashtags. First-person language may express a
general professional viewpoint, but must not imply fabricated personal
experience or achievements.

Do not claim to have researched current events or verified sources. Do not
invent citations or URLs. Return sources separately only if reliable source
metadata is actually available; otherwise return no sources and leave any
evidence-dependent claims out of the post. References are optional and should
be added and checked separately when the content needs evidence.

Return valid JSON only, with exactly these fields:
{"topic":"A specific topic","text":"The complete LinkedIn post"}

Do not wrap the JSON in Markdown fences or add commentary outside the JSON.
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
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
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

  return { topic, text, sources, checks };
}