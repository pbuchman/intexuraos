const DNS_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const RUN_ORIGIN = new RegExp(`^https://((?:${DNS_LABEL}\\.)+run\\.app)/?$`);

export function functionOrigin(value) {
  if (typeof value !== 'string') return null;

  const match = RUN_ORIGIN.exec(value);
  if (!match || match[0] !== value || match[1].length > 253) return null;

  return `https://${match[1]}`;
}
