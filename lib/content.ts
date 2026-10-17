import { env } from '@/lib/env';

export type Draft = { text: string; topic: string; sources: { title: string; url: string }[]; checks: { passed: boolean; reasons: string[] } };

function getOutputText(data: any): string {
  if (typeof data.output_text === 'string') return data.output_text;
  const parts: string[] = [];
  for (const item of data.output ?? []) for (const c of item.content ?? []) if (c.type === 'output_text' && c.text) parts.push(c.text);
  return parts.join('\n');
}

export async function generateDraft(): Promise<Draft> {
  const prompt = `You are an evidence-led Business Analyst and technology delivery practitioner writing one original LinkedIn post for a Nigeria-based BA targeting UK recruiters, product leaders, and delivery managers. Research one timely business/technology issue using web search. Rotate themes: AI governance, cybersecurity, data quality, workflow automation, digital identity, fintech, cloud resilience, accessibility, product discovery, change adoption, operational risk. Do not repeat generic AI hype. Explain the business problem, stakeholder/process impact, a practical BA intervention, and a measurable outcome or KPI to investigate (do not invent results). Separate confirmed facts from forecasts. Use credible sources and cite source URLs in the structured output. Never invent personal experience, client details, metrics, or claims. Write in natural professional English, 150-250 words, no fake personal anecdote, include a clear question or discussion prompt, and 3-5 relevant hashtags at the end. Avoid saying the content was written by AI. Return strict JSON only with keys: topic (string), text (string), sources (array of {title,url}).`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5', tools: [{ type: 'web_search' }], input: prompt }),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error(`OpenAI content generation failed (${response.status}): ${(await response.text()).slice(0,500)}`);
  const responseData = await response.json();
  const raw = getOutputText(responseData);
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('AI response did not contain valid JSON');
  const parsed = JSON.parse(json);
  const text = String(parsed.text ?? '').trim();
  const topic = String(parsed.topic ?? '').trim();
  const modelSources = Array.isArray(parsed.sources) ? parsed.sources.map((s: any) => ({ title: String(s.title ?? '').trim(), url: String(s.url ?? '').trim() })) : [];
  const citedSources: { title: string; url: string }[] = [];
  for (const item of responseData.output ?? []) for (const content of item.content ?? []) for (const annotation of content.annotations ?? []) {
    if (annotation.type === 'url_citation' && /^https:\/\//i.test(String(annotation.url ?? ''))) {
      const source = { title: String(annotation.title ?? '').trim() || String(annotation.url), url: String(annotation.url) };
      if (!citedSources.some((existing) => existing.url === source.url)) citedSources.push(source);
    }
  }
  // Trust citations actually returned by the web-search tool, not URLs the model merely typed into JSON.
  const sources = citedSources.length ? citedSources : modelSources;
  const reasons: string[] = [];
  if (text.length < 500 || text.length > 3000) reasons.push('Post length outside the configured 500–3000 character safety range.');
  if (!topic || topic.length < 5) reasons.push('Missing or vague topic.');
  if (sources.length < 2) reasons.push('Fewer than two research citations were returned by web search.');
  if (sources.some((s: any) => !/^https:\/\//i.test(s.url) || !s.title)) reasons.push('One or more source links are invalid or missing titles.');
  if (citedSources.length < 2) reasons.push('Fewer than two source URLs were confirmed in the web-search citation metadata.');
  if (/\b(I led|I delivered|my client|at my company|we achieved)\b/i.test(text)) reasons.push('Potential unverified first-person experience claim.');
  if (/\b(guaranteed|100% accurate|will definitely)\b/i.test(text)) reasons.push('Potential absolute or unsupported claim.');
  if (/(.)\1{9,}/.test(text)) reasons.push('Repeated-character anomaly detected.');
  return { topic, text, sources, checks: { passed: reasons.length === 0, reasons } };
}
