function normalizeBullet(line: string): string {
  const trimmed = line.trim();
  if (/^[-*•]\s*/.test(trimmed)) {
    return `- ${trimmed.replace(/^[-*•]\s*/, '').trim()}`;
  }
  return trimmed;
}

export function normalizePageText(rawText: string): string {
  return rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => normalizeBullet(line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
