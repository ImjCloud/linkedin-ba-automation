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

  if (!topic.trim() || topic.trim().length < 5) {
    reasons.push('Missing or vague topic.');
  }

  const validSources = sources.filter((source) => {
    if (
      !source ||
      typeof source.title !== 'string' ||
      typeof source.url !== 'string' ||
      !source.title.trim()
    ) {
      return false;
    }

    try {
      const url = new URL(source.url);
      return url.protocol === 'https:' && Boolean(url.hostname);
    } catch {
      return false;
    }
  });

  if (validSources.length < 2) {
    reasons.push(
      'Fewer than two valid HTTPS sources were provided.',
    );
  }

  const normalizedUrls = validSources.map((source) => {
    const url = new URL(source.url);
    url.hash = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  });

  if (new Set(normalizedUrls).size !== normalizedUrls.length) {
    reasons.push('Duplicate reference sources detected.');
  }

  if (
    sources.some(
      (source) =>
        !source ||
        typeof source.title !== 'string' ||
        !source.title.trim(),
    )
  ) {
    reasons.push('A source is missing its title.');
  }

  if (
    sources.some(
      (source) =>
        !source ||
        typeof source.url !== 'string' ||
        (() => {
          try {
            return new URL(source.url).protocol !== 'https:';
          } catch {
            return true;
          }
        })(),
    )
  ) {
    reasons.push('Every reference source must use a valid HTTPS URL.');
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
