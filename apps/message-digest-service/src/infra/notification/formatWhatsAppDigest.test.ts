import { createHash } from 'node:crypto';
import {
  MESSAGE_DIGEST_EVENT_MESSAGE,
  MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS,
} from '@intexuraos/whatsapp-pubsub-client';
import type { MessageDigestWhatsAppPreview } from '@intexuraos/llm-prompts';
import { describe, expect, it } from 'vitest';
import type { MessageDigestRun } from '../../domain/models/messageDigestRun.js';
import { formatWhatsAppDigest } from './formatWhatsAppDigest.js';

describe('formatWhatsAppDigest', () => {
  it('builds a Polish scan-friendly v2 template event with exact run suffix', () => {
    const result = formatWhatsAppDigest({
      run: completedRun(),
      preview: fishingPreview(),
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
            kind: 'message_digest_v2',
            digestName: 'Fishing daily',
            windowLabel: '27 lip, 09:00 – 27 lip, 14:00',
            headline: 'Jutrzejsze spotkanie ustalone',
            digestBody: [
              '🔴 WYMAGA UWAGI',
              'Potwierdź udział Michałowi.',
              'Na liście: 8 osób · Termin: nie podano',
              '',
              '👥 NOWE POTWIERDZENIA',
              'Ireneusz, Mateusz, Adam i Tomasz',
              '',
              '📍 ZAWODY',
              'Pod Krakowem · Szczegóły na Skoolu',
            ].join('\n'),
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
    expect(result.value.payloadJson).not.toContain('sourceAccountId');
    expect(result.value.payloadJson).not.toContain('summaryMarkdown');
  });

  it('renders the same deterministic hierarchy for a direct-conversation sentiment digest', () => {
    const result = formatWhatsAppDigest({
      run: completedRun({
        sourceSnapshot: { ...completedRun().sourceSnapshot, chatType: 'direct' },
        headline: 'Nastrój rozmowy poprawił się',
      }),
      preview: {
        sections: [
          { icon: 'sentiment', title: 'Sentyment', items: ['Od napięcia do spokojnego tonu.'] },
          { icon: 'decision', title: 'Ustalenie', items: ['Rozmowa będzie kontynuowana jutro.'] },
        ],
      },
      webAppUrl: 'https://intexuraos.cloud',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        event: {
          presentation: {
            kind: 'message_digest_v2',
            headline: 'Nastrój rozmowy poprawił się',
            digestBody:
              '💬 SENTYMENT\nOd napięcia do spokojnego tonu.\n\n✅ USTALENIE\nRozmowa będzie kontynuowana jutro.',
          },
        },
      },
    });
  });

  it('keeps only complete highest-priority sections when the WhatsApp body budget is exhausted', () => {
    const omittedSentinel = 'OMITTED_PRIVATE_TAIL_SENTINEL';
    const result = formatWhatsAppDigest({
      run: completedRun(),
      preview: {
        sections: [
          {
            icon: 'attention',
            title: 'Wymaga uwagi',
            items: ['A'.repeat(240), 'B'.repeat(240)],
          },
          {
            icon: 'update',
            title: 'Pozostałe',
            items: [`${'C'.repeat(200)} ${omittedSentinel}`],
          },
        ],
      },
      webAppUrl: 'https://intexuraos.cloud',
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.event.presentation?.kind !== 'message_digest_v2') {
      throw new Error('Expected Message Digest v2 presentation');
    }
    const { digestBody } = result.value.event.presentation;
    expect(Array.from(digestBody).length).toBeLessThanOrEqual(
      MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS
    );
    expect(digestBody).toContain('A'.repeat(240));
    expect(digestBody).toContain('B'.repeat(240));
    expect(digestBody).not.toContain(omittedSentinel);
    expect(digestBody).toContain('Więcej w pełnym podsumowaniu');
    expect(digestBody.endsWith('…')).toBe(true);
  });

  it('rejects a first section whose localized uppercase expansion exceeds the body budget', () => {
    expect(
      formatWhatsAppDigest({
        run: completedRun(),
        preview: {
          sections: [
            {
              icon: 'attention',
              title: 'ß'.repeat(48),
              items: ['A'.repeat(240), 'B'.repeat(240)],
            },
          ],
        },
        webAppUrl: 'https://intexuraos.cloud',
      })
    ).toEqual({ ok: false, code: 'INVALID_RUN_OUTPUT' });
  });

  it.each([
    ['headline', { run: completedRun({ headline: `Leak ${'b'.repeat(64)}` }), preview: fishingPreview() }],
    [
      'section title',
      {
        run: completedRun(),
        preview: {
          sections: [{ icon: 'update' as const, title: 'b'.repeat(64), items: ['Safe fact.'] }],
        },
      },
    ],
    [
      'section item',
      {
        run: completedRun(),
        preview: {
          sections: [{ icon: 'update' as const, title: 'Updates', items: [`Leak ${'b'.repeat(64)}`] }],
        },
      },
    ],
  ] as const)('fails closed when an evidence reference reaches the visible %s', (_label, input) => {
    expect(
      formatWhatsAppDigest({
        run: input.run,
        preview: input.preview,
        webAppUrl: 'https://intexuraos.cloud',
      })
    ).toEqual({ ok: false, code: 'INVALID_RUN_OUTPUT' });
  });

  it.each([
    ['historic lowercase ref', `Historic ${'c'.repeat(64)}`],
    ['invented uppercase ref', `Invented ${'AB'.repeat(32)}`],
    ['bare URL', 'Open https://tracking.invalid now.'],
    ['Markdown link', '[Open](/private)'],
  ])('fails closed for a %s in a preview item', (_label, unsafe) => {
    expect(
      formatWhatsAppDigest({
        run: completedRun(),
        preview: {
          sections: [{ icon: 'update', title: 'Najważniejsze', items: [unsafe] }],
        },
        webAppUrl: 'https://intexuraos.cloud',
      })
    ).toEqual({ ok: false, code: 'INVALID_RUN_OUTPUT' });
  });

  it.each([
    ['headline URL', { headline: 'Open https://tracking.invalid now.' }],
    ['headline Markdown link', { headline: '[Open](/private)' }],
    ['digest name URL', { definitionNameSnapshot: 'https://tracking.invalid' }],
  ])('fails closed for an actionable link in the %s', (_label, runPatch) => {
    expect(
      formatWhatsAppDigest({
        run: completedRun(runPatch),
        preview: fishingPreview(),
        webAppUrl: 'https://intexuraos.cloud',
      })
    ).toEqual({ ok: false, code: 'INVALID_RUN_OUTPUT' });
  });

  it('sanitizes unsafe controls while preserving deliberate line breaks and Unicode', () => {
    const result = formatWhatsAppDigest({
      run: completedRun({ headline: 'Ważne\u202e ustalenie' }),
      preview: {
        sections: [
          {
            icon: 'question',
            title: 'Pytanie\u0000',
            items: ['Czy zabrać 🎣?\u000b'],
          },
        ],
      },
      webAppUrl: 'https://intexuraos.cloud',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        event: {
          presentation: {
            kind: 'message_digest_v2',
            headline: 'Ważne ustalenie',
            digestBody: '❓ PYTANIE\nCzy zabrać 🎣?',
          },
        },
      },
    });
  });

  it('serializes byte-identically for the same immutable run and preview', () => {
    const input = {
      run: completedRun(),
      preview: fishingPreview(),
      webAppUrl: 'https://intexuraos.cloud',
    };

    expect(formatWhatsAppDigest(input)).toEqual(formatWhatsAppDigest(input));
  });

  it('rejects incomplete output, malformed previews, and unsafe application URLs', () => {
    for (const run of [
      completedRun({ generationStatus: 'processing', processingStage: 'aggregating' }),
      completedRun({ completedAt: null }),
    ]) {
      expect(
        formatWhatsAppDigest({ run, preview: fishingPreview(), webAppUrl: 'https://intexuraos.cloud' })
      ).toEqual({ ok: false, code: 'RUN_NOT_COMPLETED' });
    }
    for (const input of [
      { run: completedRun({ headline: null }), preview: fishingPreview() },
      { run: completedRun({ summaryMarkdown: null }), preview: fishingPreview() },
      { run: completedRun(), preview: { sections: [] } },
      {
        run: completedRun(),
        preview: { sections: [{ icon: 'update' as const, title: ' ', items: ['Fact.'] }] },
      },
      {
        run: completedRun(),
        preview: { sections: [{ icon: 'update' as const, title: 'Update', items: [] }] },
      },
    ]) {
      expect(
        formatWhatsAppDigest({
          run: input.run,
          preview: input.preview,
          webAppUrl: 'https://intexuraos.cloud',
        })
      ).toEqual({ ok: false, code: 'INVALID_RUN_OUTPUT' });
    }
    for (const webAppUrl of [
      'https://user@example.com',
      'https://example.com?query=1',
      'https://example.com/#private',
      'javascript:alert(1)',
    ]) {
      expect(
        formatWhatsAppDigest({ run: completedRun(), preview: fishingPreview(), webAppUrl })
      ).toEqual({ ok: false, code: 'INVALID_WEB_APP_URL' });
    }
  });

  it.each([
    ['non-object preview', null],
    ['non-object section', { sections: [null] }],
    [
      'non-string item',
      { sections: [{ icon: 'update', title: 'Najważniejsze', items: [42] }] },
    ],
    [
      'inherited object icon key',
      { sections: [{ icon: '__proto__', title: 'Najważniejsze', items: ['Concrete fact.'] }] },
    ],
  ])('rejects a structurally malformed %s', (_label, preview) => {
    expect(
      formatWhatsAppDigest({
        run: completedRun(),
        preview: preview as unknown as MessageDigestWhatsAppPreview,
        webAppUrl: 'https://intexuraos.cloud',
      })
    ).toEqual({ ok: false, code: 'INVALID_RUN_OUTPUT' });
  });

  it('rejects an invalid source window timestamp', () => {
    expect(
      formatWhatsAppDigest({
        run: completedRun({ windowStart: 'not-an-instant' }),
        preview: fishingPreview(),
        webAppUrl: 'https://intexuraos.cloud',
      })
    ).toEqual({ ok: false, code: 'INVALID_RUN_OUTPUT' });
  });

  it('maps an invalid outbound event without exposing internal validation', () => {
    expect(
      formatWhatsAppDigest({
        run: completedRun({ userId: '' }),
        preview: fishingPreview(),
        webAppUrl: 'https://intexuraos.cloud',
      })
    ).toEqual({ ok: false, code: 'INVALID_EVENT' });
  });
});

function fishingPreview(): MessageDigestWhatsAppPreview {
  return {
    sections: [
      {
        icon: 'attention',
        title: 'Wymaga uwagi',
        items: ['Potwierdź udział Michałowi.', 'Na liście: 8 osób · Termin: nie podano'],
      },
      {
        icon: 'people',
        title: 'Nowe potwierdzenia',
        items: ['Ireneusz, Mateusz, Adam i Tomasz'],
      },
      {
        icon: 'location',
        title: 'Zawody',
        items: ['Pod Krakowem · Szczegóły na Skoolu'],
      },
    ],
  };
}

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
    headline: 'Jutrzejsze spotkanie ustalone',
    summaryMarkdown: '- Spotkanie odbędzie się jutro.',
    evidenceMessageRefs: ['b'.repeat(64)],
    continuityMemoryMarkdown: 'Meet tomorrow.',
    effectiveMessageCount: 2,
    promptVersion: '3.0.0',
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
