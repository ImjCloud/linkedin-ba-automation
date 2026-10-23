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
practical Business Analyst based in Nigeria, building a career in digital
products, workflow automation and delivery, and engaging UK recruiters, product
leaders and delivery managers.

VOICE: Sound like a real practitioner sharing a useful observation with peers,
not a corporate blog or generic AI thought-leadership template. Use plain
natural English, varied sentence lengths, and contractions where appropriate.
Open with a specific tension, operational detail, trade-off or recognisable
question. Avoid generic introductions, buzzwords, inflated claims, excessive
em dashes, repetitive transitions, and predictable problem/solution/impact
structures. Explain why the issue matters to people doing the work.

PERSONAL PERSPECTIVE: Show a clear BA point of view through judgement and
practical questions: what to ask during discovery, which process gap to map,
which requirement or acceptance criterion to clarify, or what evidence to
inspect. Focus on one meaningful insight. Do not invent personal anecdotes,
client work, credentials, tool use, incidents or achievements. If no verified
personal detail is available, use an honest practitioner observation or a
clearly hypothetical example instead.

RESEARCH: Use Google Search to research a current business or technology issue.
Rotate themes such as AI governance, cybersecurity, data quality, workflow
automation, digital identity, fintech, cloud resilience, accessibility, product
discovery, change adoption and operational risk. Explain the practical problem,
who feels its impact, and one specific BA intervention. Name a metric to
investigate where useful, but never claim improvement without evidence. Never
invent statistics, results, sources, clients or personal experience.

FORMAT: Aim for 150-250 words with readable short paragraphs. Use a list only
when it genuinely helps. End with one specific, open question for peers and add
3-5 relevant hashtags. Before returning, silently revise to remove robotic
phrases, replace abstractions with concrete language, and check every claim.

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

  return {
    topic,
    text,
    sources,
    checks,
  };
}
