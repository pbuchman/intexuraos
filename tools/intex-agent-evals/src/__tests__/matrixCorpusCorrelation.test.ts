import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixTimelineEvent } from '../live/matrixClient.js';
import {
  captureMatrixCorpusCursor,
  collectCorrelatedReplies,
  digestMatrixReply,
  MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX,
  proveMatrixCorpusOutboundEvent,
  type MatrixCorpusReplyEvidencePort,
} from '../matrixCorpus/correlation.js';

const CONTEXT = {
  homeserverUrl: 'https://matrix.synthetic.test',
  accessToken: 'private-token',
  targetRoomId: '!room:home-dev',
};
const PUPPET = '@whatsapp_48123123123:home-dev';
describe('Matrix corpus reply correlation', () => {
  it('pins the exact production WhatsApp confirmation mirror rendering', () => {
    expect(MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX).toBe(
      '\n\n<Yes> - <No>\nUse the WhatsApp app to click buttons'
    );
  });

  it('proves the exact self-authored outbound event in the bound room', async () => {
    const messageText = '🧪 Scenario 001/020 · Matrix corpus · tools mocked · imc1_fixture';
    const matrix = matrixWith([
      {
        ok: true,
        nextBatch: 'cursor-2',
        limited: false,
        events: [reply('$sent-1', messageText, '@operator:home-dev')],
      },
    ]);

    await expect(
      proveMatrixCorpusOutboundEvent({
        matrix,
        context: CONTEXT,
        cursor: 'cursor-1',
        matrixUserId: '@operator:home-dev',
        matrixEventId: '$sent-1',
        messageText,
        signal: signal(),
      })
    ).resolves.toEqual({ ok: true, cursor: 'cursor-2' });
  });

  it.each([
    ['wrong event id', reply('$other', 'exact', '@operator:home-dev')],
    ['wrong sender', reply('$sent-1', 'exact', '@foreign:home-dev')],
    ['wrong text', reply('$sent-1', 'changed', '@operator:home-dev')],
  ] as const)('rejects an outbound proof with %s', async (_label, event) => {
    const result = await proveMatrixCorpusOutboundEvent({
      matrix: matrixWith([{ ok: true, nextBatch: 'cursor-2', limited: false, events: [event] }]),
      context: CONTEXT,
      cursor: 'cursor-1',
      matrixUserId: '@operator:home-dev',
      matrixEventId: '$sent-1',
      messageText: 'exact',
      signal: signal(),
    });

    expect(result).toEqual({ ok: false, code: 'outbound_event_mismatch' });
  });

  it('captures the current cursor even when the initial timeline is limited', async () => {
    const clean = matrixWith([{ ok: true, nextBatch: 'cursor-1', limited: false, events: [] }]);
    const limited = matrixWith([{ ok: true, nextBatch: 'cursor-2', limited: true, events: [] }]);

    await expect(
      captureMatrixCorpusCursor({ matrix: clean, context: CONTEXT, signal: signal() })
    ).resolves.toEqual({ ok: true, cursor: 'cursor-1' });
    await expect(
      captureMatrixCorpusCursor({ matrix: limited, context: CONTEXT, signal: signal() })
    ).resolves.toEqual({ ok: true, cursor: 'cursor-2' });
  });

  it('keeps the incremental outbound proof fail-closed after a limited initial capture', async () => {
    const messageText = 'exact outbound message';
    const matrix = matrixWith([
      { ok: true, nextBatch: 'cursor-1', limited: true, events: [] },
      {
        ok: true,
        nextBatch: 'cursor-2',
        limited: true,
        events: [reply('$sent-1', messageText, '@operator:home-dev')],
      },
    ]);
    const captured = await captureMatrixCorpusCursor({
      matrix,
      context: CONTEXT,
      signal: signal(),
    });
    if (!captured.ok) throw new Error('expected initial cursor');

    await expect(
      proveMatrixCorpusOutboundEvent({
        matrix,
        context: CONTEXT,
        cursor: captured.cursor,
        matrixUserId: '@operator:home-dev',
        matrixEventId: '$sent-1',
        messageText,
        signal: signal(),
      })
    ).resolves.toEqual({ ok: false, code: 'matrix_timeline_limited' });
    expect(matrix.syncTargetRoom).toHaveBeenLastCalledWith(
      expect.objectContaining({ since: 'cursor-1', timeoutMs: 30_000 })
    );
  });

  it('deduplicates events, ignores edits/redactions, and returns the exact durable reply set', async () => {
    const first = reply('$reply-1', 'First');
    const matrix = matrixWith([
      {
        ok: true,
        nextBatch: 'cursor-2',
        limited: false,
        events: [
          first,
          first,
          {
            ...reply('$edit', 'Edited'),
            content: {
              msgtype: 'm.text',
              body: 'Edited',
              'm.relates_to': { rel_type: 'm.replace' },
            },
          },
          { ...reply('$redacted', 'Secret'), unsigned: { redacted_because: true } },
        ],
      },
      { ok: true, nextBatch: 'cursor-3', limited: false, events: [reply('$reply-2', 'Second')] },
    ]);
    const evidence = evidenceWith([
      { status: 'pending' },
      {
        status: 'completed',
        replyCount: 2,
        replyDigests: [digestMatrixReply('First', 0), digestMatrixReply('Second', 1)],
      },
    ]);

    const result = await collectCorrelatedReplies(baseInput(matrix, evidence));

    expect(result).toMatchObject({
      ok: true,
      cursor: 'cursor-3',
      replies: [{ body: 'First' }, { body: 'Second' }],
    });
  });

  it('correlates the exact WhatsApp confirmation mirror with the durable assistant reply', async () => {
    const assistantReply = 'Save this note?\n\nContent: [redacted]';
    const matrix = matrixWith([
      {
        ok: true,
        nextBatch: 'cursor-2',
        limited: false,
        events: [
          reply('$reply-1', `${assistantReply}${MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX}`),
        ],
      },
    ]);
    const evidence = evidenceWith([
      {
        status: 'completed',
        replyCount: 1,
        replyDigests: [digestMatrixReply(assistantReply, 0)],
      },
    ]);

    const result = await collectCorrelatedReplies({
      ...baseInput(matrix, evidence),
      expectedReplyRendering: 'whatsapp_confirmation_buttons',
    });

    expect(result).toMatchObject({
      ok: true,
      replies: [
        {
          eventId: '$reply-1',
          body: assistantReply,
          digest: digestMatrixReply(assistantReply, 0),
        },
      ],
    });
  });

  it.each([
    ['plain rendering policy', MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX, 'plain'],
    ['missing interactive suffix', '', 'whatsapp_confirmation_buttons'],
    [
      'changed button label',
      '\n\n<Confirm> - <No>\nUse the WhatsApp app to click buttons',
      'whatsapp_confirmation_buttons',
    ],
    [
      'changed instruction',
      '\n\n<Yes> - <No>\nUse WhatsApp to click buttons',
      'whatsapp_confirmation_buttons',
    ],
    [
      'extra trailing newline',
      `${MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX}\n`,
      'whatsapp_confirmation_buttons',
    ],
  ] as const)('rejects a confirmation mirror with %s', async (_label, suffix, rendering) => {
    const assistantReply = 'Save this note?';
    const result = await collectCorrelatedReplies({
      ...baseInput(
        matrixWith([
          {
            ok: true,
            nextBatch: 'cursor-2',
            limited: false,
            events: [reply('$reply-1', `${assistantReply}${suffix}`)],
          },
        ]),
        evidenceWith([
          {
            status: 'completed',
            replyCount: 1,
            replyDigests: [digestMatrixReply(assistantReply, 0)],
          },
        ])
      ),
      expectedReplyRendering: rendering,
    });

    expect(result).toEqual({ ok: false, code: 'unbound_reply' });
  });

  it('rejects a confirmation mirror without a non-empty assistant body', async () => {
    const result = await collectCorrelatedReplies({
      ...baseInput(
        matrixWith([
          {
            ok: true,
            nextBatch: 'cursor-2',
            limited: false,
            events: [reply('$reply-1', MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX)],
          },
        ]),
        evidenceWith([
          {
            status: 'completed',
            replyCount: 1,
            replyDigests: [digestMatrixReply('', 0)],
          },
        ])
      ),
      expectedReplyRendering: 'whatsapp_confirmation_buttons',
    });

    expect(result).toEqual({ ok: false, code: 'unbound_reply' });
  });

  it('rejects duplicate event identities whose raw Matrix bodies differ after normalization', async () => {
    const assistantReply = 'Save this note?';
    const result = await collectCorrelatedReplies({
      ...baseInput(
        matrixWith([
          {
            ok: true,
            nextBatch: 'cursor-2',
            limited: false,
            events: [
              reply('$reply-1', `${assistantReply}${MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX}`),
              reply('$reply-1', assistantReply),
            ],
          },
        ]),
        evidenceWith([{ status: 'pending' }])
      ),
      expectedReplyRendering: 'whatsapp_confirmation_buttons',
    });

    expect(result).toEqual({ ok: false, code: 'unbound_reply' });
  });

  it.each([
    ['wrong puppet', [reply('$wrong', 'Reply', '@whatsapp_999:home-dev')], 'wrong_puppet'],
    [
      'missing event identity',
      [{ type: 'm.room.message', sender: PUPPET, content: { msgtype: 'm.text', body: 'Reply' } }],
      'invalid_reply_event',
    ],
    ['limited poll', [], 'matrix_timeline_limited'],
  ] as const)('fails closed for %s', async (_label, events, code) => {
    const matrix = matrixWith([
      { ok: true, nextBatch: 'cursor-2', limited: code === 'matrix_timeline_limited', events },
    ]);
    const result = await collectCorrelatedReplies(
      baseInput(matrix, evidenceWith([{ status: 'pending' }]))
    );
    expect(result).toEqual({ ok: false, code });
  });

  it('rejects a sixth correlated reply and an unbound completed reply', async () => {
    const six = Array.from({ length: 6 }, (_, index) =>
      reply(`$reply-${String(index)}`, `Reply ${String(index)}`)
    );
    const overflow = await collectCorrelatedReplies(
      baseInput(
        matrixWith([{ ok: true, nextBatch: 'next', limited: false, events: six }]),
        evidenceWith([{ status: 'pending' }])
      )
    );
    expect(overflow).toEqual({ ok: false, code: 'reply_overflow' });

    const unbound = await collectCorrelatedReplies(
      baseInput(
        matrixWith([
          { ok: true, nextBatch: 'next', limited: false, events: [reply('$reply', 'Wrong')] },
        ]),
        evidenceWith([
          { status: 'completed', replyCount: 1, replyDigests: [digestMatrixReply('Expected')] },
        ])
      )
    );
    expect(unbound).toEqual({ ok: false, code: 'unbound_reply' });
  });

  it('rejects a separately redacted reply before durable completion', async () => {
    const matrix = matrixWith([
      {
        ok: true,
        nextBatch: 'cursor-2',
        limited: false,
        events: [reply('$reply-redacted', 'Transient')],
      },
      {
        ok: true,
        nextBatch: 'cursor-3',
        limited: false,
        events: [
          {
            eventId: '$redaction',
            originServerTs: 1_721_466_000_001,
            redacts: '$reply-redacted',
            type: 'm.room.redaction',
            sender: '@operator:home-dev',
            content: {},
          },
        ],
      },
    ]);

    const result = await collectCorrelatedReplies(
      baseInput(matrix, evidenceWith([{ status: 'pending' }, { status: 'pending' }]))
    );

    expect(result).toEqual({ ok: false, code: 'unbound_reply' });
  });

  it('rejects a standalone redaction without an event identity or target', async () => {
    const result = await collectCorrelatedReplies(
      baseInput(
        matrixWith([
          {
            ok: true,
            nextBatch: 'cursor-2',
            limited: false,
            events: [
              {
                type: 'm.room.redaction',
                sender: '@operator:home-dev',
                content: {},
              },
            ],
          },
        ]),
        evidenceWith([{ status: 'pending' }])
      )
    );

    expect(result).toEqual({ ok: false, code: 'matrix_sync_invalid' });
  });

  it('maps an aborted Matrix wait to timeout and a terminal failure separately', async () => {
    const controller = new AbortController();
    controller.abort();
    const timeout = await collectCorrelatedReplies({
      ...baseInput(matrixWith([]), evidenceWith([])),
      signal: controller.signal,
    });
    expect(timeout).toEqual({ ok: false, code: 'reply_timeout' });

    const failed = await collectCorrelatedReplies(
      baseInput(
        matrixWith([{ ok: true, nextBatch: 'next', limited: false, events: [] }]),
        evidenceWith([{ status: 'failed', failureCode: 'EXECUTION_REJECTED' }])
      )
    );
    expect(failed).toEqual({ ok: false, code: 'turn_processing_failed' });
  });
});

function baseInput(
  matrix: MatrixClient,
  evidence: MatrixCorpusReplyEvidencePort
): Parameters<typeof collectCorrelatedReplies>[0] {
  return {
    matrix,
    evidence,
    context: CONTEXT,
    cursor: 'cursor-1',
    matrixUserId: '@operator:home-dev',
    expectedPuppetSender: PUPPET,
    runId: 'run_1',
    scenarioId: 'intex-eval-001',
    turnIndex: 0,
    sessionId: 'session_1',
    expectedReplyRendering: 'plain',
    signal: signal(),
  } as const;
}

function reply(eventId: string, body: string, sender = PUPPET): MatrixTimelineEvent {
  return {
    eventId,
    originServerTs: 1_721_466_000_000,
    type: 'm.room.message',
    sender,
    content: { msgtype: 'm.text', body },
  };
}

function matrixWith(results: Awaited<ReturnType<MatrixClient['syncTargetRoom']>>[]): MatrixClient {
  return {
    whoAmI: vi.fn<MatrixClient['whoAmI']>(async () => ({
      ok: true,
      userId: '@operator:home-dev',
    })),
    syncTargetRoom: vi.fn<MatrixClient['syncTargetRoom']>(
      async () => results.shift() ?? { ok: false, reason: 'unavailable' }
    ),
  };
}

function evidenceWith(
  results: Awaited<ReturnType<MatrixCorpusReplyEvidencePort['getTurnTerminal']>>[]
): MatrixCorpusReplyEvidencePort {
  return {
    getTurnTerminal: vi.fn<MatrixCorpusReplyEvidencePort['getTurnTerminal']>(
      async () => results.shift() ?? { status: 'pending' }
    ),
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}
