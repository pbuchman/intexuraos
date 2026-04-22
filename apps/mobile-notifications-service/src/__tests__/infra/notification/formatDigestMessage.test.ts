import { describe, it, expect } from 'vitest';
import { formatDigestMessage } from '../../../infra/notification/formatDigestMessage.js';

describe('formatDigestMessage', () => {
  it('emits emoji header, bullets and message count', () => {
    const msg = formatDigestMessage({
      headline: 'Quiet day on the lake',
      bullets: ['Rain forecast', 'New member joined', 'Gear tip on line X'],
      messageCount: 42,
    });
    expect(msg).toContain('📬 Quiet day on the lake');
    expect(msg).toContain('• Rain forecast');
    expect(msg).toContain('• New member joined');
    expect(msg).toContain('• Gear tip on line X');
    expect(msg).toContain('42 messages today');
  });

  it('keeps at most 5 bullets', () => {
    const msg = formatDigestMessage({
      headline: 'h',
      bullets: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      messageCount: 1,
    });
    expect(msg).toContain('• a');
    expect(msg).toContain('• e');
    expect(msg).not.toContain('• f');
    expect(msg).not.toContain('• g');
  });

  it('truncates each bullet to 180 chars with ellipsis', () => {
    const long = 'x'.repeat(500);
    const msg = formatDigestMessage({
      headline: 'h',
      bullets: [long],
      messageCount: 1,
    });
    const bulletLine = msg.split('\n').find((l) => l.startsWith('• ')) ?? '';
    expect(bulletLine.length).toBeLessThanOrEqual('• '.length + 180 + 1); // '…'
    expect(bulletLine.endsWith('…')).toBe(true);
  });

  it('keeps total body under 900 chars even with long headline', () => {
    const msg = formatDigestMessage({
      headline: 'y'.repeat(400),
      bullets: ['x'.repeat(180), 'x'.repeat(180), 'x'.repeat(180), 'x'.repeat(180), 'x'.repeat(180)],
      messageCount: 99,
    });
    expect(msg.length).toBeLessThanOrEqual(900);
  });

  it('uses singular grammar for one message', () => {
    const msg = formatDigestMessage({ headline: 'h', bullets: ['a', 'b', 'c'], messageCount: 1 });
    expect(msg).toContain('1 message today');
  });
});
