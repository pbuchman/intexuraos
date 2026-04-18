const MAX_BULLETS = 5;
const MAX_BULLET_CHARS = 180;
const MAX_BODY_CHARS = 900;

export interface FormatDigestMessageInput {
  readonly headline: string;
  readonly bullets: readonly string[];
  readonly messageCount: number;
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

export function formatDigestMessage(input: FormatDigestMessageInput): string {
  const bullets = input.bullets
    .slice(0, MAX_BULLETS)
    .map((b) => `• ${truncate(b, MAX_BULLET_CHARS)}`);
  const noun = input.messageCount === 1 ? 'message' : 'messages';
  const body = [
    `📬 ${input.headline}`,
    '',
    ...bullets,
    '',
    `${String(input.messageCount)} ${noun} today`,
  ].join('\n');
  return truncate(body, MAX_BODY_CHARS);
}
