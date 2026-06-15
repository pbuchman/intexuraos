const STOPWORDS = new Set(['and', 'for', 'from', 'that', 'this', 'did']);

export function extractSearchTerms(question: string): string[] {
  const matches = question.toLowerCase().match(/\p{L}+/gu) ?? [];
  const unique = new Set<string>();

  for (const match of matches) {
    if (match.length < 3) continue;
    if (STOPWORDS.has(match)) continue;
    unique.add(match);
  }

  return [...unique];
}
