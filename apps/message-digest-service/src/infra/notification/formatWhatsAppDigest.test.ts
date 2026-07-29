import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MESSAGE_DIGEST_EVENT_MESSAGE } from '@intexuraos/whatsapp-pubsub-client';
import type { MessageDigestRun } from '../../domain/models/messageDigestRun.js';
import { formatWhatsAppDigest } from './formatWhatsAppDigest.js';

describe('formatWhatsAppDigest', () => {
  it('builds the bounded primary-user template event with exact run suffix', () => {
    const result = formatWhatsAppDigest({
      run: completedRun(),
      webAppUrl: 'https://intexuraos.cloud/',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        event: {
          type: 'whatsapp.message.send',
          userId: 'synthetic-user-001',
          message: MESSAGE_DIGEST_EVENT_MESSAGE,
          correlationId: 'mdr_run_001',
          timestamp: '2026-07-27T12:02:00.000Z',
          presentation: {
            kind: 'message_digest_v1',
            digestName: 'Fishing daily',
            digestExcerpt: 'Meet at the lake at 07:00. Bring the nets.',
            runUrlSuffix:
              '#/whatsapp/message-digests/md_definition_001/history/mdr_run_001',
          },
          deliveryAuthorization: {
            kind: 'message_digest_delivery_v1',
            definitionId: 'md_definition_001',
            runId: 'mdr_run_001',
          },
          retainMessageText: false,
          important: true,
          idempotencyKey: 'message-digest:mdr_run_001',
        },
        payloadJson: expect.any(String),
        payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    if (!result.ok) throw new Error(result.code);
    expect(result.value.payloadJson).toBe(JSON.stringify(result.value.event));
    expect(result.value.payloadDigest).toBe(
      createHash('sha256').update(result.value.payloadJson, 'utf8').digest('hex')
    );
    expect(result.value.payloadJson).not.toContain('phone');
    expect(result.value.payloadJson).not.toContain('sourceAccountId');
  });

  it('normalizes Markdown into a readable bounded template excerpt without source evidence', () => {
    const result = formatWhatsAppDigest({
      run: completedRun({
        summaryMarkdown: [
          '# Plan',
          '',
          '- Meet **Anna** at [the lake](https://example.com/private).',
          '- Bring `two nets`.',
          '',
          `Private marker ${'x'.repeat(1_100)} PRIVATE_EVENT_TAIL_SENTINEL`,
        ].join('\n'),
        evidenceMessageRefs: ['EVIDENCE_PRIVATE_SENTINEL'],
        sourceSnapshot: {
          ...completedRun().sourceSnapshot,
          sourceAccountId: 'SOURCE_ACCOUNT_PRIVATE_SENTINEL',
          chatId: 'CHAT_PRIVATE_SENTINEL',
        },
      }),
      webAppUrl: 'https://intexuraos.cloud',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.value.event.presentation).toMatchObject({
      kind: 'message_digest_v1',
      digestName: 'Fishing daily',
      digestExcerpt: expect.stringMatching(
        /^Plan Meet Anna at the lake\. Bring two nets\. Private marker/u
      ),
    });
    if (result.value.event.presentation?.kind !== 'message_digest_v1') {
      throw new Error('Expected Message Digest presentation');
    }
    expect(Array.from(result.value.event.presentation.digestExcerpt).length).toBe(876);
    expect(result.value.event.presentation.digestExcerpt.endsWith('…')).toBe(true);
    expect(JSON.stringify(result.value.event.presentation)).not.toContain(
      'EVIDENCE_PRIVATE_SENTINEL'
    );
    expect(JSON.stringify(result.value.event.presentation)).not.toContain(
      'SOURCE_ACCOUNT_PRIVATE_SENTINEL'
    );
    expect(JSON.stringify(result.value.event.presentation)).not.toContain('CHAT_PRIVATE_SENTINEL');
    expect(result.value.payloadJson).not.toContain('PRIVATE_EVENT_TAIL_SENTINEL');
    expect(result.value.event.message).toBe(MESSAGE_DIGEST_EVENT_MESSAGE);
  });

  it('uses the bounded configured name without duplicating the generated headline', () => {
    const headline = `PRIVATE_HEADLINE_SENTINEL ${'h'.repeat(170)}`;
    const result = formatWhatsAppDigest({
      run: completedRun({
        definitionNameSnapshot: 'n'.repeat(80),
        headline,
        summaryMarkdown: 's'.repeat(2_000),
      }),
      webAppUrl: 'https://intexuraos.cloud',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.value.event.presentation).toMatchObject({
      kind: 'message_digest_v1',
      digestName: 'n'.repeat(80),
    });
    if (result.value.event.presentation?.kind !== 'message_digest_v1') {
      throw new Error('Expected Message Digest presentation');
    }
    expect(Array.from(result.value.event.presentation.digestExcerpt)).toHaveLength(876);
    expect(result.value.event.presentation.digestExcerpt.endsWith('…')).toBe(true);
    expect(
      68 +
        Array.from(result.value.event.presentation.digestName).length +
        Array.from(result.value.event.presentation.digestExcerpt).length
    ).toBe(1_024);
    expect(result.value.event.message).toBe(MESSAGE_DIGEST_EVENT_MESSAGE);
    expect(result.value.payloadJson).not.toContain('PRIVATE_HEADLINE_SENTINEL');
  });

  it('keeps the envelope neutral while bounding the Unicode template excerpt', () => {
    const run = completedRun({
      headline: 'Headline\u202e',
      summaryMarkdown: `${'🎣'.repeat(4_000)}\u0000 hidden control`,
    });

    const result = formatWhatsAppDigest({ run, webAppUrl: 'https://intexuraos.cloud' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.value.event.message).toBe(MESSAGE_DIGEST_EVENT_MESSAGE);
    expect(result.value.payloadJson).not.toContain('\u202e');
    expect(result.value.payloadJson).not.toContain('\u0000');
    expect(Array.from(result.value.event.presentation?.digestExcerpt ?? '')).toHaveLength(876);
    expect(result.value.event.presentation?.digestExcerpt.endsWith('\ud83c')).toBe(false);
  });

  it('serializes byte-identically for the same immutable run', () => {
    const input = { run: completedRun(), webAppUrl: 'https://intexuraos.cloud' };

    const first = formatWhatsAppDigest(input);
    const second = formatWhatsAppDigest(input);

    expect(second).toEqual(first);
  });

  it('rejects incomplete output and unsafe application URLs without constructing a payload', () => {
    expect(
      formatWhatsAppDigest({
        run: completedRun({ generationStatus: 'processing', processingStage: 'aggregating' }),
        webAppUrl: 'https://intexuraos.cloud',
      })
    ).toEqual({ ok: false, code: 'RUN_NOT_COMPLETED' });
    expect(
      formatWhatsAppDigest({
        run: completedRun({ summaryMarkdown: null }),
        webAppUrl: 'https://intexuraos.cloud',
      })
    ).toEqual({ ok: false, code: 'INVALID_RUN_OUTPUT' });
    expect(formatWhatsAppDigest({ run: completedRun(), webAppUrl: 'javascript:alert(1)' })).toEqual(
      { ok: false, code: 'INVALID_WEB_APP_URL' }
    );
  });

  it('rejects each incomplete lifecycle and blank output shape', () => {
    for (const run of [
      completedRun({ processingStage: 'aggregating' }),
      completedRun({ completedAt: null }),
    ]) {
      expect(formatWhatsAppDigest({ run, webAppUrl: 'https://intexuraos.cloud' })).toEqual({
        ok: false,
        code: 'RUN_NOT_COMPLETED',
      });
    }
    for (const run of [
      completedRun({ headline: null }),
      completedRun({ headline: ' \u0000 ' }),
      completedRun({ summaryMarkdown: ' \u0000 ' }),
      completedRun({ summaryMarkdown: '***' }),
    ]) {
      expect(formatWhatsAppDigest({ run, webAppUrl: 'https://intexuraos.cloud' })).toEqual({
        ok: false,
        code: 'INVALID_RUN_OUTPUT',
      });
    }
  });

  it('accepts a clean HTTP origin and rejects credentials, query, hash, and malformed URLs', () => {
    expect(
      formatWhatsAppDigest({ run: completedRun(), webAppUrl: 'http://localhost:3000' })
    ).toMatchObject({ ok: true });
    for (const webAppUrl of [
      'https://user@example.com',
      'https://user:password@example.com',
      'https://example.com?query=1',
      'https://example.com/#private',
      'not-a-url',
    ]) {
      expect(formatWhatsAppDigest({ run: completedRun(), webAppUrl })).toEqual({
        ok: false,
        code: 'INVALID_WEB_APP_URL',
      });
    }
  });

  it('maps an invalid outbound event without exposing internal validation', () => {
    expect(
      formatWhatsAppDigest({
        run: completedRun({ userId: '' }),
        webAppUrl: 'https://intexuraos.cloud',
      })
    ).toEqual({ ok: false, code: 'INVALID_EVENT' });
  });
});

function completedRun(overrides: Partial<MessageDigestRun> = {}): MessageDigestRun {
  return {
    version: 1,
    runId: 'mdr_run_001',
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    definitionNameSnapshot: 'Fishing daily',
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: 1,
    instructionRevision: '1',
    trigger: 'manual',
    requestIdDigest: 'a'.repeat(64),
    windowStart: '2026-07-27T07:00:00.000Z',
    windowEnd: '2026-07-27T12:00:00.000Z',
    scheduledBoundary: '2026-07-27T12:00:00.000Z',
    generationStatus: 'completed',
    processingStage: 'completed',
    lease: null,
    attempts: 1,
    sourceSnapshot: {
      type: 'private_whatsapp',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      displayName: 'Fishing friends',
      sourceRevision: 'opaque-source-revision',
    },
    instructionsSnapshot: {
      templateId: 'fishing_group',
      text: 'Summarize concrete decisions, plans, catches, and follow-ups from this chat.',
      revision: '1',
    },
    scheduleSnapshot: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    headline: 'Tomorrow morning agreed',
    summaryMarkdown: '- Meet at the lake at 07:00.\n- Bring the nets.',
    evidenceMessageRefs: ['b'.repeat(64)],
    continuityMemoryMarkdown: 'Meet tomorrow.',
    effectiveMessageCount: 2,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
    delivery: {
      type: 'whatsapp_primary',
      status: 'pending',
      idempotencyKey: 'message-digest:mdr_run_001',
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: '2026-07-27T12:02:00.000Z',
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T12:01:00.000Z',
    updatedAt: '2026-07-27T12:02:00.000Z',
    completedAt: '2026-07-27T12:02:00.000Z',
    ...overrides,
  };
}
