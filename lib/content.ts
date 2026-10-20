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
Create one original, evidence-led LinkedIn post for a Nigeria-based Business
Analyst targeting UK recruiters, product leaders and delivery managers.

Research a current business or technology issue using Google Search. Rotate
themes such as AI governance, cybersecurity, data quality, workflow automation,
digital identity, fintech, cloud resilience, accessibility, product discovery,
change adoption and operational risk.

Explain the business problem, stakeholder or process impact, a practical BA
intervention, and a measurable outcome or KPI to investigate. Do not invent
results, personal experience, clients, metrics or facts. Distinguish facts from
forecasts. Use natural professional English, 150-250 words, a discussion
question, and 3-5 relevant hashtags.

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
