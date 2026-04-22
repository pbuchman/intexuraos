import { describe, it, expect, vi } from 'vitest';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher, PublishError } from '@intexuraos/infra-pubsub';
import { WhatsAppDigestNotifier } from '../../../infra/notification/whatsappDigestNotifier.js';

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function fakePublisher(impl: (params: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0]) => Promise<Result<void, PublishError>>): WhatsAppSendPublisher {
  return { publishSendMessage: impl };
}

describe('WhatsAppDigestNotifier', () => {
  it('publishes a WhatsApp message with a CTA pointing at the saved digest', async () => {
    const captured: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0][] = [];
    const publisher = fakePublisher(async (p) => { captured.push(p); return ok(undefined); });
    const notifier = new WhatsAppDigestNotifier({
      publisher,
      webAppUrl: 'https://intexuraos.cloud',
      logger: noopLogger,
    });
    const result = await notifier.sendDigestReady({
      userId: 'u1',
      groupKey: 'my group',
      date: '2026-04-15',
      headline: 'Quiet day',
      bullets: ['a', 'b', 'c'],
      messageCount: 7,
    });
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.userId).toBe('u1');
    expect(captured[0]?.message).toContain('Quiet day');
    expect(captured[0]?.ctaUrl?.displayText).toBe('View Full Digest');
    expect(captured[0]?.ctaUrl?.url).toBe(
      'https://intexuraos.cloud/#/notifications/digests/my%20group/2026-04-15'
    );
    expect(captured[0]?.correlationId).toBe('digest-ready-u1-my%20group-2026-04-15');
    // INT-1418 (plan follow-up #1881): daily digest is important.
    expect(captured[0]?.important).toBe(true);
  });

  it('returns notification_failed error when publisher returns err', async () => {
    const publisher = fakePublisher(async () => err({ code: 'PUBLISH_FAILED', message: 'boom' }));
    const notifier = new WhatsAppDigestNotifier({
      publisher,
      webAppUrl: 'https://intexuraos.cloud',
      logger: noopLogger,
    });
    const result = await notifier.sendDigestReady({
      userId: 'u', groupKey: 'g', date: '2026-04-15',
      headline: 'h', bullets: ['a', 'b', 'c'], messageCount: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('notification_failed');
    expect(result.error.message).toContain('boom');
  });

  it('trims trailing slash in webAppUrl before building the CTA', async () => {
    const captured: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0][] = [];
    const publisher = fakePublisher(async (p) => { captured.push(p); return ok(undefined); });
    const notifier = new WhatsAppDigestNotifier({
      publisher,
      webAppUrl: 'https://intexuraos.cloud/',
      logger: noopLogger,
    });
    await notifier.sendDigestReady({
      userId: 'u', groupKey: 'g', date: '2026-04-15',
      headline: 'h', bullets: ['a', 'b', 'c'], messageCount: 1,
    });
    expect(captured[0]?.ctaUrl?.url).toBe('https://intexuraos.cloud/#/notifications/digests/g/2026-04-15');
  });
});
