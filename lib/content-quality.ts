export type DraftSource = { title: string; url: string };

export function validateDraft(
  topic: string,
  text: string,
  sources: DraftSource[],
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (text.trim().length < 500 || text.trim().length > 3000) {
    reasons.push('Post length must be between 500 and 3000 characters.');
  }

  if (!topic || topic.trim().length < 5) {
    reasons.push('Missing or vague topic.');
  }

  const validSources = sources.filter(
    (source) => /^https:\/\//i.test(source.url) && source.title.trim(),
  );

  if (validSources.length < 2) {
    reasons.push(
      'Fewer than two HTTPS sources were confirmed in Google Search grounding metadata.',
    );
  }

  if (sources.some((source) => !source.title.trim())) {
    reasons.push('A source is missing its title.');
  }

  if (/\b(I led|I delivered|my client|at my company|we achieved)\b/i.test(text)) {
    reasons.push('Potential unverified first-person experience claim.');
  }

  if (/\b(guaranteed|100% accurate|will definitely)\b/i.test(text)) {
    reasons.push('Potential absolute or unsupported claim.');
  }

  if (/(.)\1{9,}/.test(text)) {
    reasons.push('Repeated-character anomaly detected.');
  }

  return { passed: reasons.length === 0, reasons };
}
