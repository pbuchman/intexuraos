import { describe, expect, it } from 'vitest';

import {
  acceptReplyPublication,
  beginTurnCompletion,
  closeTurnCompleted,
  closeTurnFailed,
  createOpenTurnPublication,
  isValidTurnPublication,
  recoverInterruptedTurn,
  reserveReplyPublication,
} from '../../../domain/matrixCorpus/correlation.js';

const now = '2026-07-20T10:00:00.000Z';
const digest = (value: number): string => value.toString(16).padStart(64, '0');

describe('Matrix corpus turn correlation', () => {
  it.each([1, 2, 3, 4, 5])('closes exactly %i contiguous durable replies', (replyCount) => {
    const expectedReplyDigests = Array.from({ length: replyCount }, (_, index) => digest(index + 1));
    let state = beginTurnCompletion(createOpenTurnPublication(), {
      expectedReplyDigests,
      now,
    });
    expect(state.ok).toBe(true);
    if (!state.ok) return;

    for (let replyIndex = 0; replyIndex < replyCount; replyIndex += 1) {
      const reserved = reserveReplyPublication(state.publication, {
        replyIndex,
        replyDigest: expectedReplyDigests[replyIndex] ?? '',
        idempotencyKeyDigest: digest(100 + replyIndex),
        now,
      });
      expect(reserved.ok).toBe(true);
      if (!reserved.ok) return;
      const accepted = acceptReplyPublication(reserved.publication, {
        replyIndex,
        replyDigest: expectedReplyDigests[replyIndex] ?? '',
        idempotencyKeyDigest: digest(100 + replyIndex),
        publicationReceiptDigest: digest(200 + replyIndex),
        now,
      });
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) return;
      state = accepted;
    }

    const completed = closeTurnCompleted(state.publication, { now });
    expect(completed).toEqual({
      ok: true,
      disposition: 'applied',
      publication: expect.objectContaining({
        phase: 'closed',
        terminal: {
          kind: 'completed',
          replyCount,
          replyDigests: expectedReplyDigests,
          publicationReceiptDigests: Array.from({ length: replyCount }, (_, index) =>
            digest(200 + index)
          ),
          closedAt: now,
        },
      }),
    });
  });

  it('accepts exact reserve/accept/close replays without adding a second reply', () => {
    const expectedReplyDigests = [digest(1)];
    const begun = beginTurnCompletion(createOpenTurnPublication(), {
      expectedReplyDigests,
      now,
    });
    if (!begun.ok) throw new Error('fixture failed');
    const reserved = reserveReplyPublication(begun.publication, {
      replyIndex: 0,
      replyDigest: digest(1),
      idempotencyKeyDigest: digest(2),
      now,
    });
    if (!reserved.ok) throw new Error('fixture failed');
    expect(
      reserveReplyPublication(reserved.publication, {
        replyIndex: 0,
        replyDigest: digest(1),
        idempotencyKeyDigest: digest(2),
        now: '2026-07-20T10:00:01.000Z',
      })
    ).toMatchObject({ ok: true, disposition: 'already_applied' });
    const accepted = acceptReplyPublication(reserved.publication, {
      replyIndex: 0,
      replyDigest: digest(1),
      idempotencyKeyDigest: digest(2),
      publicationReceiptDigest: digest(3),
      now,
    });
    if (!accepted.ok) throw new Error('fixture failed');
    expect(
      acceptReplyPublication(accepted.publication, {
        replyIndex: 0,
        replyDigest: digest(1),
        idempotencyKeyDigest: digest(2),
        publicationReceiptDigest: digest(3),
        now: '2026-07-20T10:00:01.000Z',
      })
    ).toMatchObject({ ok: true, disposition: 'already_applied' });
    const completed = closeTurnCompleted(accepted.publication, { now });
    if (!completed.ok) throw new Error('fixture failed');
    expect(
      closeTurnCompleted(completed.publication, { now: '2026-07-20T10:00:01.000Z' })
    ).toMatchObject({ ok: true, disposition: 'already_applied' });
  });

  it.each([
    ['sixth expected reply', Array.from({ length: 6 }, (_, index) => digest(index + 1))],
    ['empty expected replies', []],
    ['duplicate expected digest', [digest(1), digest(1)]],
    ['malformed expected digest', ['private-transport-id']],
  ])('rejects %s', (_label, expectedReplyDigests) => {
    expect(
      beginTurnCompletion(createOpenTurnPublication(), { expectedReplyDigests, now })
    ).toEqual({ ok: false, code: 'INVALID_CORRELATION' });
  });

  it('rejects out-of-order, unbound, contradictory, and sixth publications', () => {
    const expectedReplyDigests = Array.from({ length: 5 }, (_, index) => digest(index + 1));
    const begun = beginTurnCompletion(createOpenTurnPublication(), {
      expectedReplyDigests,
      now,
    });
    if (!begun.ok) throw new Error('fixture failed');

    expect(
      reserveReplyPublication(begun.publication, {
        replyIndex: 1,
        replyDigest: digest(2),
        idempotencyKeyDigest: digest(12),
        now,
      })
    ).toEqual({ ok: false, code: 'OUT_OF_ORDER_REPLY' });
    expect(
      reserveReplyPublication(begun.publication, {
        replyIndex: 0,
        replyDigest: digest(99),
        idempotencyKeyDigest: digest(10),
        now,
      })
    ).toEqual({ ok: false, code: 'UNBOUND_REPLY' });

    let state = begun.publication;
    for (let replyIndex = 0; replyIndex < 5; replyIndex += 1) {
      const reserved = reserveReplyPublication(state, {
        replyIndex,
        replyDigest: expectedReplyDigests[replyIndex] ?? '',
        idempotencyKeyDigest: digest(10 + replyIndex),
        now,
      });
      if (!reserved.ok) throw new Error('fixture failed');
      const accepted = acceptReplyPublication(reserved.publication, {
        replyIndex,
        replyDigest: expectedReplyDigests[replyIndex] ?? '',
        idempotencyKeyDigest: digest(10 + replyIndex),
        publicationReceiptDigest: digest(20 + replyIndex),
        now,
      });
      if (!accepted.ok) throw new Error('fixture failed');
      state = accepted.publication;
    }
    expect(
      reserveReplyPublication(state, {
        replyIndex: 5,
        replyDigest: digest(6),
        idempotencyKeyDigest: digest(15),
        now,
      })
    ).toEqual({ ok: false, code: 'REPLY_LIMIT_EXCEEDED' });
    expect(
      acceptReplyPublication(state, {
        replyIndex: 0,
        replyDigest: digest(1),
        idempotencyKeyDigest: digest(10),
        publicationReceiptDigest: digest(999),
        now,
      })
    ).toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
  });

  it('recovers only a fully accepted completion and otherwise closes ambiguous work as failed', () => {
    const begun = beginTurnCompletion(createOpenTurnPublication(), {
      expectedReplyDigests: [digest(1)],
      now,
    });
    if (!begun.ok) throw new Error('fixture failed');
    const reserved = reserveReplyPublication(begun.publication, {
      replyIndex: 0,
      replyDigest: digest(1),
      idempotencyKeyDigest: digest(2),
      now,
    });
    if (!reserved.ok) throw new Error('fixture failed');

    expect(recoverInterruptedTurn(reserved.publication, { now })).toMatchObject({
      ok: true,
      disposition: 'failed_ambiguous',
      publication: {
        phase: 'closed',
        terminal: { kind: 'failed', code: 'AMBIGUOUS_EXTERNAL_EFFECT' },
      },
    });

    const accepted = acceptReplyPublication(reserved.publication, {
      replyIndex: 0,
      replyDigest: digest(1),
      idempotencyKeyDigest: digest(2),
      publicationReceiptDigest: digest(3),
      now,
    });
    if (!accepted.ok) throw new Error('fixture failed');
    expect(recoverInterruptedTurn(accepted.publication, { now })).toMatchObject({
      ok: true,
      disposition: 'completed_recovered',
      publication: { phase: 'closed', terminal: { kind: 'completed', replyCount: 1 } },
    });
  });

  it('validates every persisted publication, reply, and terminal field fail-closed', () => {
    const begun = beginTurnCompletion(createOpenTurnPublication(), {
      expectedReplyDigests: [digest(1)],
      now,
    });
    if (!begun.ok) throw new Error('fixture failed');
    const reserved = reserveReplyPublication(begun.publication, {
      replyIndex: 0,
      replyDigest: digest(1),
      idempotencyKeyDigest: digest(2),
      now,
    });
    if (!reserved.ok) throw new Error('fixture failed');
    const accepted = acceptReplyPublication(reserved.publication, {
      replyIndex: 0,
      replyDigest: digest(1),
      idempotencyKeyDigest: digest(2),
      publicationReceiptDigest: digest(3),
      now,
    });
    if (!accepted.ok) throw new Error('fixture failed');
    const closed = closeTurnCompleted(accepted.publication, { now });
    if (!closed.ok) throw new Error('fixture failed');
    const baseReply = reserved.publication.replies[0];
    if (baseReply === undefined) throw new Error('reply fixture failed');

    for (const invalid of [
      null,
      [],
      { ...createOpenTurnPublication(), version: 2 },
      { ...createOpenTurnPublication(), phase: 'invalid' },
      { ...createOpenTurnPublication(), replies: 'invalid' },
      { ...createOpenTurnPublication(), replies: Array.from({ length: 6 }, () => baseReply) },
      { ...createOpenTurnPublication(), expectedReplyDigests: [] },
      { ...createOpenTurnPublication(), expectedReplyDigests: [digest(1)] },
      { ...createOpenTurnPublication(), replies: [baseReply] },
      { ...begun.publication, expectedReplyDigests: null },
      { ...begun.publication, replies: [null] },
      { ...reserved.publication, replies: [{ ...baseReply, replyIndex: 0.5 }] },
      { ...reserved.publication, replies: [{ ...baseReply, replyIndex: -1 }] },
      { ...reserved.publication, replies: [{ ...baseReply, replyIndex: 5 }] },
      { ...reserved.publication, replies: [{ ...baseReply, replyDigest: 1 }] },
      { ...reserved.publication, replies: [{ ...baseReply, replyDigest: 'invalid' }] },
      { ...reserved.publication, replies: [{ ...baseReply, idempotencyKeyDigest: 1 }] },
      { ...reserved.publication, replies: [{ ...baseReply, idempotencyKeyDigest: 'invalid' }] },
      { ...reserved.publication, replies: [{ ...baseReply, state: 'invalid' }] },
      { ...reserved.publication, replies: [{ ...baseReply, reservedAt: 'invalid' }] },
      {
        ...reserved.publication,
        replies: [{ ...baseReply, publicationReceiptDigest: digest(3) }],
      },
      { ...reserved.publication, replies: [{ ...baseReply, acceptedAt: now }] },
      {
        ...accepted.publication,
        replies: [{ ...accepted.publication.replies[0], publicationReceiptDigest: 1 }],
      },
      {
        ...accepted.publication,
        replies: [{ ...accepted.publication.replies[0], publicationReceiptDigest: 'invalid' }],
      },
      {
        ...accepted.publication,
        replies: [{ ...accepted.publication.replies[0], acceptedAt: 'invalid' }],
      },
      { ...closed.publication, terminal: null },
      { ...closed.publication, terminal: { ...closed.publication.terminal, closedAt: 'invalid' } },
      {
        ...closed.publication,
        terminal: { kind: 'failed', code: 'INVALID', closedAt: now },
      },
      {
        ...closed.publication,
        terminal: { ...closed.publication.terminal, replyCount: 0 },
      },
      {
        ...closed.publication,
        terminal: { ...closed.publication.terminal, replyCount: 6 },
      },
      {
        ...closed.publication,
        terminal: { ...closed.publication.terminal, replyDigests: [] },
      },
      {
        ...closed.publication,
        terminal: { ...closed.publication.terminal, publicationReceiptDigests: 'invalid' },
      },
      {
        ...closed.publication,
        terminal: { ...closed.publication.terminal, publicationReceiptDigests: [] },
      },
      {
        ...closed.publication,
        terminal: { ...closed.publication.terminal, publicationReceiptDigests: ['invalid'] },
      },
      { ...begun.publication, terminal: { kind: 'failed', code: 'EXECUTION_REJECTED', closedAt: now } },
    ])
      expect(isValidTurnPublication(invalid)).toBe(false);
    for (const code of [
      'AMBIGUOUS_EXTERNAL_EFFECT',
      'REPLY_PUBLICATION_REJECTED',
      'EXECUTION_REJECTED',
    ] as const)
      expect(
        isValidTurnPublication({
          version: 1,
          phase: 'closed',
          expectedReplyDigests: null,
          replies: [],
          terminal: { kind: 'failed', code, closedAt: now },
        })
      ).toBe(true);
  });

  it('rejects malformed operation inputs and contradictory replays at every stage', () => {
    const open = createOpenTurnPublication();
    expect(beginTurnCompletion(open, { expectedReplyDigests: [digest(1)], now: 'invalid' })).toEqual({
      ok: false,
      code: 'INVALID_CORRELATION',
    });
    expect(beginTurnCompletion({ ...open, version: 2 as 1 }, { expectedReplyDigests: [digest(1)], now })).toEqual({
      ok: false,
      code: 'INVALID_CORRELATION',
    });
    const begun = beginTurnCompletion(open, { expectedReplyDigests: [digest(1)], now });
    if (!begun.ok) throw new Error('fixture failed');
    expect(beginTurnCompletion(begun.publication, { expectedReplyDigests: [digest(1)], now })).toMatchObject({
      ok: true,
      disposition: 'already_applied',
    });
    expect(beginTurnCompletion(begun.publication, { expectedReplyDigests: [digest(2)], now })).toEqual({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });

    for (const input of [
      { replyIndex: 0.5, replyDigest: digest(1), idempotencyKeyDigest: digest(2), now },
      { replyIndex: -1, replyDigest: digest(1), idempotencyKeyDigest: digest(2), now },
      { replyIndex: 0, replyDigest: 'invalid', idempotencyKeyDigest: digest(2), now },
      { replyIndex: 0, replyDigest: digest(1), idempotencyKeyDigest: 'invalid', now },
      { replyIndex: 0, replyDigest: digest(1), idempotencyKeyDigest: digest(2), now: 'invalid' },
    ])
      expect(reserveReplyPublication(begun.publication, input)).toEqual({
        ok: false,
        code: 'INVALID_CORRELATION',
      });
    expect(
      reserveReplyPublication(open, {
        replyIndex: 0,
        replyDigest: digest(1),
        idempotencyKeyDigest: digest(2),
        now,
      })
    ).toEqual({ ok: false, code: 'INVALID_STATE' });
    const reserved = reserveReplyPublication(begun.publication, {
      replyIndex: 0,
      replyDigest: digest(1),
      idempotencyKeyDigest: digest(2),
      now,
    });
    if (!reserved.ok) throw new Error('fixture failed');
    expect(
      reserveReplyPublication(reserved.publication, {
        replyIndex: 0,
        replyDigest: digest(9),
        idempotencyKeyDigest: digest(2),
        now,
      })
    ).toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    expect(
      reserveReplyPublication(reserved.publication, {
        replyIndex: 0,
        replyDigest: digest(1),
        idempotencyKeyDigest: digest(9),
        now,
      })
    ).toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });

    const validAccept = {
      replyIndex: 0,
      replyDigest: digest(1),
      idempotencyKeyDigest: digest(2),
      publicationReceiptDigest: digest(3),
      now,
    };
    expect(acceptReplyPublication(open, validAccept)).toEqual({ ok: false, code: 'INVALID_STATE' });
    expect(acceptReplyPublication(begun.publication, validAccept)).toEqual({ ok: false, code: 'OUT_OF_ORDER_REPLY' });
    expect(acceptReplyPublication(reserved.publication, { ...validAccept, replyDigest: digest(9) })).toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    expect(acceptReplyPublication(reserved.publication, { ...validAccept, idempotencyKeyDigest: digest(9) })).toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    expect(acceptReplyPublication(reserved.publication, { ...validAccept, publicationReceiptDigest: 'invalid' })).toEqual({ ok: false, code: 'INVALID_CORRELATION' });

    expect(closeTurnCompleted(open, { now })).toEqual({ ok: false, code: 'INVALID_STATE' });
    expect(closeTurnCompleted(open, { now: 'invalid' })).toEqual({ ok: false, code: 'INVALID_CORRELATION' });
    expect(closeTurnFailed(open, { code: 'EXECUTION_REJECTED', now: 'invalid' })).toEqual({
      ok: false,
      code: 'INVALID_CORRELATION',
    });
    const failed = closeTurnFailed(open, { code: 'EXECUTION_REJECTED', now });
    if (!failed.ok) throw new Error('fixture failed');
    expect(closeTurnFailed(failed.publication, { code: 'EXECUTION_REJECTED', now })).toMatchObject({ ok: true, disposition: 'already_applied' });
    expect(closeTurnFailed(failed.publication, { code: 'REPLY_PUBLICATION_REJECTED', now })).toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    expect(closeTurnCompleted(failed.publication, { now })).toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    expect(recoverInterruptedTurn(failed.publication, { now })).toMatchObject({ ok: true, disposition: 'terminal' });
    expect(recoverInterruptedTurn(open, { now: 'invalid' })).toEqual({ ok: false, code: 'INVALID_CORRELATION' });
  });
});
