import type { MessageDigestSourceMessage } from '@intexuraos/llm-prompts';
import { describe, expect, it, vi } from 'vitest';
import type {
  MessageDigestAggregationInput,
  MessageDigestAggregator,
  MessageDigestWhatsAppClient,
} from '../ports/messageDigestClients.js';
import { previewMessageDigest } from './previewMessageDigest.js';

const NOW = '2026-07-27T12:00:00.000Z';
const REF_A = 'a'.repeat(64);
const REF_B = 'b'.repeat(64);

describe('previewMessageDigest', () => {
  it('reads the current open cadence window through one frozen paginated snapshot', async () => {
    const harness = createHarness({
      pages: [
        {
          messages: [message(REF_A, 'First fact', '2026-07-27T08:00:00.000Z')],
          sourceRevision: 'snapshot-revision',
          highWatermark: 'snapshot-high-watermark',
          nextCursor: 'snapshot-cursor-1',
        },
        {
          messages: [message(REF_B, 'Second fact', '2026-07-27T09:00:00.000Z')],
          sourceRevision: 'snapshot-revision',
          highWatermark: 'snapshot-high-watermark',
          nextCursor: null,
        },
      ],
    });

    const result = await previewMessageDigest(validInput(), harness.dependencies);

    expect(harness.queryMessages).toHaveBeenNthCalledWith(1, {
      userId: 'synthetic-user-001',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      windowStart: '2026-07-27T07:00:00.000Z',
      windowEnd: NOW,
      limit: 200,
    });
    expect(harness.queryMessages).toHaveBeenNthCalledWith(2, {
      userId: 'synthetic-user-001',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      windowStart: '2026-07-27T07:00:00.000Z',
      windowEnd: NOW,
      limit: 200,
      cursor: 'snapshot-cursor-1',
    });
    expect(harness.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'synthetic-user-001',
        correlationId: 'synthetic-preview-001',
        chatType: 'group',
        conversationLabel: 'Fishing friends',
        windowStart: '2026-07-27T07:00:00.000Z',
        windowEnd: NOW,
        instructions: 'Summarize important decisions and concrete follow-ups.',
        continuityMemoryMarkdown: '',
        previousSummaries: [],
        messages: [
          message(REF_A, 'First fact', '2026-07-27T08:00:00.000Z'),
          message(REF_B, 'Second fact', '2026-07-27T09:00:00.000Z'),
        ],
      })
    );
    expect(harness.aggregate.mock.calls[0]?.[0]).not.toHaveProperty('outputLanguage');
    expect(result).toEqual({
      ok: true,
      preview: {
        status: 'generated',
        window: {
          start: '2026-07-27T07:00:00.000Z',
          end: NOW,
          timeZone: 'Europe/Warsaw',
        },
        source: { chatType: 'group', displayName: 'Fishing friends' },
        deliveryReadiness: { status: 'ready', maskedPrimaryNumber: '+48•••123' },
        messageCount: 2,
        content: {
          headline: 'Two concrete facts',
          summaryMarkdown: '- First fact\n- Second fact',
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('snapshot-revision');
    expect(JSON.stringify(result)).not.toContain('snapshot-high-watermark');
    expect(JSON.stringify(result)).not.toContain('continuityMemoryMarkdown');
    expect(JSON.stringify(result)).not.toContain('costUsd');
    expect(JSON.stringify(result)).not.toContain(REF_A);
  });

  it('validates source and current delivery readiness before reading messages', async () => {
    const sourceFailure = createHarness({ sourceFailure: 'not_found' });
    await expect(previewMessageDigest(validInput(), sourceFailure.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_NOT_FOUND',
    });
    expect(sourceFailure.getDeliveryReadiness).not.toHaveBeenCalled();
    expect(sourceFailure.queryMessages).not.toHaveBeenCalled();
    expect(sourceFailure.aggregate).not.toHaveBeenCalled();

    const readinessFailure = createHarness({ readinessFailure: 'unavailable' });
    await expect(
      previewMessageDigest(validInput(), readinessFailure.dependencies)
    ).resolves.toEqual({ ok: false, code: 'READINESS_UNAVAILABLE' });
    expect(readinessFailure.queryMessages).not.toHaveBeenCalled();
    expect(readinessFailure.aggregate).not.toHaveBeenCalled();
  });

  it('allows a non-delivering preview while truthfully returning setup-required readiness', async () => {
    const harness = createHarness({ readinessStatus: 'mapping_missing', pages: [emptyPage()] });

    await expect(previewMessageDigest(validInput(), harness.dependencies)).resolves.toMatchObject({
      ok: true,
      preview: {
        status: 'no_activity',
        deliveryReadiness: { status: 'mapping_missing' },
      },
    });
  });

  it('returns no-activity without content when the safe source window is empty', async () => {
    const harness = createHarness({ pages: [emptyPage()], aggregateKind: 'empty' });

    await expect(previewMessageDigest(validInput(), harness.dependencies)).resolves.toEqual({
      ok: true,
      preview: {
        status: 'no_activity',
        window: {
          start: '2026-07-27T07:00:00.000Z',
          end: NOW,
          timeZone: 'Europe/Warsaw',
        },
        source: { chatType: 'group', displayName: 'Fishing friends' },
        deliveryReadiness: { status: 'ready', maskedPrimaryNumber: '+48•••123' },
        messageCount: 0,
        content: null,
      },
    });
    expect(harness.aggregate).toHaveBeenCalledWith(expect.objectContaining({ messages: [] }));
  });

  it('fails closed when a frozen page changes or a cursor loops', async () => {
    const changed = createHarness({
      pages: [
        { ...emptyPage(), highWatermark: 'watermark-a', nextCursor: 'cursor-1' },
        { ...emptyPage(), highWatermark: 'watermark-b' },
      ],
    });
    await expect(previewMessageDigest(validInput(), changed.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_CHANGED',
    });
    expect(changed.aggregate).not.toHaveBeenCalled();

    const looping = createHarness({
      pages: [
        { ...emptyPage(), nextCursor: 'cursor-1' },
        { ...emptyPage(), nextCursor: 'cursor-1' },
      ],
    });
    await expect(previewMessageDigest(validInput(), looping.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_CHANGED',
    });
    expect(looping.aggregate).not.toHaveBeenCalled();
  });

  it.each([
    ['source_changed', 'SOURCE_CHANGED'],
    ['not_found', 'SOURCE_NOT_FOUND'],
    ['invalid_response', 'SOURCE_UNAVAILABLE'],
    ['unavailable', 'SOURCE_UNAVAILABLE'],
  ] as const)('maps safe source query failure %s to %s', async (sourceFailure, expectedCode) => {
    const harness = createHarness({ queryFailure: sourceFailure });

    await expect(previewMessageDigest(validInput(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: expectedCode,
    });
    expect(harness.aggregate).not.toHaveBeenCalled();
  });

  it('validates the unsaved form and maps aggregation failures without leaking details', async () => {
    const invalid = createHarness();
    await expect(
      previewMessageDigest(
        validInput({ instructions: { templateId: 'custom', text: ' too short ' } }),
        invalid.dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(invalid.validateSource).not.toHaveBeenCalled();

    const failed = createHarness({ aggregationFailure: 'LLM_UNAVAILABLE' });
    await expect(previewMessageDigest(validInput(), failed.dependencies)).resolves.toEqual({
      ok: false,
      code: 'LLM_UNAVAILABLE',
    });
  });

  it('rejects every malformed form boundary, invalid clock, and invalid schedule before source reads', async () => {
    const valid = validInput();
    const invalidInputs = [
      { ...valid, userId: ' ' },
      { ...valid, userId: 'x'.repeat(257) },
      { ...valid, correlationId: ' ' },
      { ...valid, correlationId: 'x'.repeat(257) },
      { ...valid, source: { chatId: ' ' } },
      { ...valid, source: { chatId: 'x'.repeat(4_097) } },
      { ...valid, instructions: { templateId: 'custom' as const, text: 'too short' } },
      { ...valid, instructions: { templateId: 'custom' as const, text: 'x'.repeat(4_001) } },
      { ...valid, instructions: { templateId: 'other', text: valid.instructions.text } },
    ];
    for (const input of invalidInputs) {
      const harness = createHarness();
      await expect(
        previewMessageDigest(
          input as Parameters<typeof previewMessageDigest>[0],
          harness.dependencies
        )
      ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
      expect(harness.validateSource).not.toHaveBeenCalled();
    }

    const invalidNow = createHarness();
    invalidNow.dependencies.now = (): string => 'not-an-instant';
    await expect(previewMessageDigest(valid, invalidNow.dependencies)).resolves.toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });

    const invalidSchedule = createHarness();
    await expect(
      previewMessageDigest(
        { ...valid, schedule: { kind: 'daily', localTime: 'invalid', timeZone: 'UTC' } },
        invalidSchedule.dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_SCHEDULE' });
  });

  it('accepts all supported instruction templates and maps unavailable source validation', async () => {
    for (const templateId of ['direct_sentiment', 'custom'] as const) {
      const harness = createHarness();
      await expect(
        previewMessageDigest(
          validInput({ instructions: { templateId, text: validInput().instructions.text } }),
          harness.dependencies
        )
      ).resolves.toMatchObject({ ok: true, preview: { status: 'generated' } });
    }

    const unavailable = createHarness({ sourceFailure: 'unavailable' });
    await expect(previewMessageDigest(validInput(), unavailable.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_UNAVAILABLE',
    });
  });

  it('fails closed on source revision drift and the bounded page ceiling', async () => {
    const revisionChanged = createHarness({
      pages: [
        { ...emptyPage(), sourceRevision: 'revision-a', nextCursor: 'cursor-1' },
        { ...emptyPage(), sourceRevision: 'revision-b' },
      ],
    });
    await expect(
      previewMessageDigest(validInput(), revisionChanged.dependencies)
    ).resolves.toEqual({ ok: false, code: 'SOURCE_CHANGED' });

    const pages = Array.from({ length: 25 }, (_, index) => ({
      ...emptyPage(),
      nextCursor: `cursor-${index + 1}`,
    }));
    const tooLarge = createHarness({ pages });
    await expect(previewMessageDigest(validInput(), tooLarge.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_TOO_LARGE',
    });
    expect(tooLarge.queryMessages).toHaveBeenCalledTimes(25);
  });

  it('rejects inconsistent aggregator contracts and forwards safe aggregator failures', async () => {
    for (const invalidAggregateShape of ['empty_with_content', 'aggregate_without_content'] as const) {
      const harness = createHarness({ invalidAggregateShape });
      await expect(previewMessageDigest(validInput(), harness.dependencies)).resolves.toEqual({
        ok: false,
        code: 'INVALID_AGGREGATE',
      });
    }
    for (const aggregationFailure of ['SOURCE_TOO_LARGE', 'INVALID_AGGREGATE'] as const) {
      const harness = createHarness({ aggregationFailure });
      await expect(previewMessageDigest(validInput(), harness.dependencies)).resolves.toEqual({
        ok: false,
        code: aggregationFailure,
      });
    }
  });

  it('omits a masked number when ready delivery intentionally has no display hint', async () => {
    const harness = createHarness({ omitMaskedNumber: true });
    const result = await previewMessageDigest(validInput(), harness.dependencies);

    expect(result).toMatchObject({
      ok: true,
      preview: { deliveryReadiness: { status: 'ready' } },
    });
    expect(JSON.stringify(result)).not.toContain('maskedPrimaryNumber');
  });
});

interface HarnessOptions {
  sourceFailure?: 'not_found' | 'unavailable';
  readinessFailure?: 'unavailable';
  readinessStatus?: 'ready' | 'mapping_missing' | 'disconnected' | 'delivery_disabled';
  queryFailure?: 'source_changed' | 'not_found' | 'invalid_response' | 'unavailable';
  pages?: SourcePage[];
  aggregateKind?: 'aggregate' | 'empty';
  aggregationFailure?: 'SOURCE_TOO_LARGE' | 'LLM_UNAVAILABLE' | 'INVALID_AGGREGATE';
  invalidAggregateShape?: 'empty_with_content' | 'aggregate_without_content';
  omitMaskedNumber?: boolean;
}

interface SourcePage {
  messages: MessageDigestSourceMessage[];
  sourceRevision: string;
  highWatermark: string | null;
  nextCursor: string | null;
}

function createHarness(options: HarnessOptions = {}): {
  dependencies: {
    whatsappClient: MessageDigestWhatsAppClient;
    aggregator: MessageDigestAggregator;
    now(): string;
  };
  validateSource: ReturnType<typeof vi.fn<MessageDigestWhatsAppClient['validateSource']>>;
  getDeliveryReadiness: ReturnType<
    typeof vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>
  >;
  queryMessages: ReturnType<typeof vi.fn<MessageDigestWhatsAppClient['queryMessages']>>;
  aggregate: ReturnType<typeof vi.fn<MessageDigestAggregator['aggregate']>>;
} {
  const pages = options.pages ?? [defaultPage()];
  let pageIndex = 0;
  const validateSource = vi.fn<MessageDigestWhatsAppClient['validateSource']>(async () =>
    options.sourceFailure === undefined
      ? {
          ok: true,
          value: {
            sourceAccountId: 'synthetic-account-001',
            generationId: 'synthetic-generation-001',
            chatId: 'synthetic-chat-001',
            chatType: 'group',
            displayName: 'Fishing friends',
            messageCount: 123,
            sourceRevision: 'validated-source-revision',
          },
        }
      : { ok: false, code: options.sourceFailure }
  );
  const getDeliveryReadiness = vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>(
    async () =>
      options.readinessFailure === undefined
        ? {
            ok: true,
            value: {
              status: options.readinessStatus ?? 'ready',
              ...((options.readinessStatus === undefined || options.readinessStatus === 'ready') &&
              options.omitMaskedNumber !== true
                ? { maskedPrimaryNumber: '+48•••123' }
                : {}),
              observationVersion: 'readiness-v1',
              observedAt: NOW,
            },
          }
        : { ok: false, code: options.readinessFailure }
  );
  const queryMessages = vi.fn<MessageDigestWhatsAppClient['queryMessages']>(async () =>
    options.queryFailure === undefined
      ? { ok: true, value: pages[pageIndex++] ?? emptyPage() }
      : { ok: false, code: options.queryFailure }
  );
  const getOutboundDeliveryState = vi.fn<
    MessageDigestWhatsAppClient['getOutboundDeliveryState']
  >(async () => ({ ok: true, value: { status: 'pending' } }));
  const aggregate = vi.fn<MessageDigestAggregator['aggregate']>(
    async (input: MessageDigestAggregationInput) => {
      if (options.aggregationFailure !== undefined) {
        return { ok: false, code: options.aggregationFailure };
      }
      const kind = options.aggregateKind ?? (input.messages.length === 0 ? 'empty' : 'aggregate');
      if (options.invalidAggregateShape === 'empty_with_content') {
        return {
          ok: true,
          kind: 'empty',
          aggregate: {
            headline: 'Invalid content',
            summaryMarkdown: '- Must not exist.',
            whatsappPreview: {
              sections: [{ icon: 'update', title: 'Najważniejsze', items: ['Must not exist.'] }],
            },
            evidenceMessageRefs: [],
            continuityMemoryMarkdown: '',
          },
          metadata: aggregateMetadata(input.messages.length),
        };
      }
      if (options.invalidAggregateShape === 'aggregate_without_content') {
        return {
          ok: true,
          kind: 'aggregate',
          aggregate: null,
          metadata: aggregateMetadata(input.messages.length),
        };
      }
      return {
        ok: true,
        kind,
        aggregate:
          kind === 'empty'
            ? null
            : {
                headline: 'Two concrete facts',
                summaryMarkdown: '- First fact\n- Second fact',
                whatsappPreview: {
                  sections: [
                    { icon: 'update', title: 'Najważniejsze', items: ['Two concrete facts.'] },
                  ],
                },
                evidenceMessageRefs: [REF_A, REF_B],
                continuityMemoryMarkdown: 'Internal continuity only.',
              },
        metadata: aggregateMetadata(input.messages.length),
      };
    }
  );
  return {
    dependencies: {
      whatsappClient: {
        validateSource,
        getDeliveryReadiness,
        getOutboundDeliveryState,
        authorizeOutboundDeliveryRetry: vi.fn(async () => ({ ok: true as const })),
        queryMessages,
      },
      aggregator: { aggregate },
      now: (): string => NOW,
    },
    validateSource,
    getDeliveryReadiness,
    queryMessages,
    aggregate,
  };
}

function aggregateMetadata(effectiveMessageCount: number): {
  effectiveMessageCount: number;
  promptVersion: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
} {
  return {
    effectiveMessageCount,
    promptVersion: '1.0.0',
    model: 'or:synthetic/digest-model',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
  };
}

function validInput(
  overrides: Partial<{
    instructions: {
      templateId: 'fishing_group' | 'direct_sentiment' | 'custom';
      text: string;
    };
  }> = {}
): {
  userId: string;
  correlationId: string;
  source: { chatId: string };
  instructions: {
    templateId: 'fishing_group' | 'direct_sentiment' | 'custom';
    text: string;
  };
  schedule: { kind: 'daily'; localTime: string; timeZone: string };
} {
  return {
    userId: 'synthetic-user-001',
    correlationId: 'synthetic-preview-001',
    source: { chatId: 'synthetic-chat-001' },
    instructions: {
      templateId: 'fishing_group',
      text: 'Summarize important decisions and concrete follow-ups.',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    ...overrides,
  };
}

function defaultPage(): SourcePage {
  return {
    messages: [message(REF_A, 'First fact', '2026-07-27T08:00:00.000Z')],
    sourceRevision: 'snapshot-revision',
    highWatermark: 'snapshot-high-watermark',
    nextCursor: null,
  };
}

function emptyPage(): SourcePage {
  return {
    messages: [],
    sourceRevision: 'snapshot-revision',
    highWatermark: null,
    nextCursor: null,
  };
}

function message(
  messageRef: string,
  text: string,
  eventTimestamp: string
): MessageDigestSourceMessage {
  return {
    messageRef,
    eventTimestamp,
    direction: 'inbound' as const,
    authorLabel: 'Synthetic participant',
    text,
    contentKind: 'text' as const,
  };
}
