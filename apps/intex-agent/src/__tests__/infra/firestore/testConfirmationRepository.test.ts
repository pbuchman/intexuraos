import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { describe, expect, it } from 'vitest';

import type {
  MatrixCorpusTestConfirmationIdentity,
  TestConfirmationRepository,
} from '../../../domain/matrixCorpus/ports/testConfirmationRepository.js';
import { createMatrixCorpusContextCrypto } from '../../../domain/matrixCorpus/contextCrypto.js';

import {
  FirestoreTestConfirmationRepository,
  INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION,
  parseMatrixCorpusTestConfirmationEvidenceDocument,
} from '../../../infra/firestore/testConfirmationRepository.js';

const createdAt = '2026-07-20T10:00:00.000Z';
const expiresAt = '2026-07-20T10:05:00.000Z';
const paddedWamid = `wamid.${'A'.repeat(58)}==`;

function identity(
  overrides: Partial<MatrixCorpusTestConfirmationIdentity> = {}
): MatrixCorpusTestConfirmationIdentity {
  return {
    confirmationId: 'confirmation_1',
    runId: 'run_1',
    scenarioId: 'scenario_1',
    sessionId: 'session_1',
    userId: 'user_1',
    leaseFence: '7',
    ...overrides,
  };
}

function pendingInput(
  overrides: Partial<Parameters<TestConfirmationRepository['createOrGet']>[0]> = {}
): Parameters<TestConfirmationRepository['createOrGet']>[0] {
  return {
    identity: identity(),
    toolName: 'create_note' as const,
    toolArgs: { content: 'Synthetic Matrix note' },
    selectionTurnIndex: 0,
    selectionOrdinal: 1,
    createdAt,
    expiresAt,
    ...overrides,
  };
}

function fixture(): Readonly<{
  firestore: Firestore;
  crypto: ReturnType<typeof createMatrixCorpusContextCrypto>;
  repository: FirestoreTestConfirmationRepository;
}> {
  const firestore = createFakeFirestore() as unknown as Firestore;
  const crypto = createMatrixCorpusContextCrypto({
    key: Buffer.alloc(32, 7),
    keyVersion: 'context-key-v1',
    randomBytes: () => Buffer.alloc(12, 3),
  });
  return {
    firestore,
    crypto,
    repository: new FirestoreTestConfirmationRepository({
      firestore,
      crypto,
    }),
  };
}

describe('FirestoreTestConfirmationRepository', () => {
  it('verifies complete AEAD-bound confirmation evidence for a run owner', async () => {
    const { firestore, crypto, repository } = fixture();
    await repository.createOrGet(pendingInput());
    const snapshot = await firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .doc('confirmation_1')
      .get();

    expect(
      parseMatrixCorpusTestConfirmationEvidenceDocument(
        snapshot.id,
        snapshot.data(),
        crypto,
        identity()
      )
    ).toEqual({
      confirmationId: 'confirmation_1',
      runId: 'run_1',
      scenarioId: 'scenario_1',
      sessionId: 'session_1',
      leaseFence: '7',
    });
    expect(
      parseMatrixCorpusTestConfirmationEvidenceDocument(
        snapshot.id,
        { ...snapshot.data(), sessionId: 'session_2' },
        crypto,
        identity()
      )
    ).toBeUndefined();
    expect(
      parseMatrixCorpusTestConfirmationEvidenceDocument(
        snapshot.id,
        null,
        crypto,
        identity()
      )
    ).toBeUndefined();
    expect(
      parseMatrixCorpusTestConfirmationEvidenceDocument(
        snapshot.id,
        { scenarioId: 1, sessionId: 'session_1' },
        crypto,
        identity()
      )
    ).toBeUndefined();
    expect(
      parseMatrixCorpusTestConfirmationEvidenceDocument(
        snapshot.id,
        { scenarioId: 'scenario_1', sessionId: 1 },
        crypto,
        identity()
      )
    ).toBeUndefined();
  });

  it('creates one immutable Matrix-corpus confirmation foundation', async () => {
    const { firestore, repository } = fixture();

    await expect(repository.createOrGet(pendingInput())).resolves.toEqual({
      ok: true,
      disposition: 'applied',
      confirmation: {
        version: 1,
        lane: 'matrix_corpus',
        runtimeAudience: 'hetzner-prod',
        ...identity(),
        state: 'pending',
        toolName: 'create_note',
        toolArgs: { content: 'Synthetic Matrix note' },
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
        createdAt,
        expiresAt,
        decision: null,
        resolutionMessageId: null,
        resolvedAt: null,
      },
    });
    const stored = await firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .doc('confirmation_1')
      .get();
    expect(JSON.stringify(stored.data())).not.toContain('Synthetic Matrix note');
    expect(stored.data()).not.toHaveProperty('toolArgs');
    expect(stored.data()).toHaveProperty('encryptedToolArgs');
    for (const forbiddenField of ['userId', 'text', 'payload', 'mock', 'arguments'])
      expect(stored.data()).not.toHaveProperty(forbiddenField);
  });

  it('round-trips a complete calendar snapshot only through encrypted confirmation arguments', async () => {
    const { firestore, repository } = fixture();
    const toolArgs = {
      eventId: 'mock_event_private',
      eventSummary: 'Private event summary',
      attendeesToAdd: ['private.person@example.com'],
      calendarId: 'mock_calendar_private',
      expectedEtag: '"private-event-v1"',
      eventStart: { dateTime: '2026-08-20T10:00:00.000Z' },
      eventEnd: { dateTime: '2026-08-20T11:00:00.000Z' },
    };

    await repository.createOrGet(
      pendingInput({ toolName: 'update_calendar_event', toolArgs })
    );

    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toMatchObject({
      ok: true,
      confirmation: { toolName: 'update_calendar_event', toolArgs },
    });
    const stored = await firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .doc('confirmation_1')
      .get();
    const serialized = JSON.stringify(stored.data());
    for (const privateValue of [
      toolArgs.eventId,
      toolArgs.eventSummary,
      toolArgs.attendeesToAdd[0],
      toolArgs.calendarId,
      toolArgs.expectedEtag,
      toolArgs.eventStart.dateTime,
      toolArgs.eventEnd.dateTime,
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(stored.data()).not.toHaveProperty('toolArgs');
    expect(stored.data()).toHaveProperty('encryptedToolArgs');
  });

  it('rejects tampered ciphertext and ciphertext replay under another confirmation identity', async () => {
    const { firestore, repository } = fixture();
    await repository.createOrGet(pendingInput());
    const originalRef = firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .doc('confirmation_1');
    const original = (await originalRef.get()).data() as Record<string, unknown>;
    const encrypted = original['encryptedToolArgs'] as Record<string, unknown>;

    await originalRef.set({
      ...original,
      encryptedToolArgs: {
        ...encrypted,
        ciphertext: `${String(encrypted['ciphertext'])}A`,
      },
    });
    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_CONFIRMATION',
    });

    const replayedIdentity = identity({ confirmationId: 'confirmation_2' });
    await firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .doc(replayedIdentity.confirmationId)
      .set({ ...original, confirmationId: replayedIdentity.confirmationId });
    await expect(repository.getExact({ ...replayedIdentity, now: createdAt })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_CONFIRMATION',
    });
  });

  it.each([
    ['tool name', { toolName: 'create_calendar_event' }],
    ['selection turn', { selectionTurnIndex: 1 }],
    ['selection ordinal', { selectionOrdinal: 2 }],
    ['creation time', { createdAt: '2026-07-20T10:01:00.000Z' }],
    ['expiry', { expiresAt: '2026-07-20T10:04:00.000Z' }],
  ])('rejects tampered authenticated confirmation metadata: %s', async (_name, changed) => {
    const { firestore, repository } = fixture();
    await repository.createOrGet(pendingInput());
    const ref = firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .doc('confirmation_1');
    const stored = (await ref.get()).data() as Record<string, unknown>;
    await ref.set({ ...stored, ...changed });

    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_CONFIRMATION',
    });
  });

  it.each([
    ['state', { state: 'pending' }],
    ['decision', { decision: 'reject' }],
    ['resolution message', { resolutionMessageId: 'transport_confirmation_2' }],
    ['resolution time', { resolvedAt: '2026-07-20T10:01:00.001Z' }],
  ])(
    'rejects separately tampered authenticated resolved metadata: %s',
    async (_name, changed) => {
      const { firestore, repository } = fixture();
      await repository.createOrGet(pendingInput());
      await repository.resolveExact({
        identity: identity(),
        decision: 'confirm',
        resolutionMessageId: 'transport_confirmation_1',
        now: '2026-07-20T10:01:00.000Z',
      });
      const ref = firestore
        .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
        .doc('confirmation_1');
      const stored = (await ref.get()).data() as Record<string, unknown>;
      await ref.set({ ...stored, ...changed });

      await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_CONFIRMATION',
      });
    }
  );

  it('returns the first immutable record for exact sequential and concurrent duplicates', async () => {
    const { repository } = fixture();
    const first = repository.createOrGet(pendingInput());
    const second = repository.createOrGet(pendingInput());
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({ ok: true, disposition: 'applied', confirmation: { createdAt } });
    expect(secondResult).toMatchObject({
      ok: true,
      disposition: 'already_applied',
      confirmation: { createdAt },
    });
    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toEqual({
      ok: true,
      confirmation: {
        version: 1,
        lane: 'matrix_corpus',
        runtimeAudience: 'hetzner-prod',
        ...identity(),
        state: 'pending',
        toolName: 'create_note',
        toolArgs: { content: 'Synthetic Matrix note' },
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
        createdAt,
        expiresAt,
        decision: null,
        resolutionMessageId: null,
        resolvedAt: null,
      },
    });
  });

  it('rejects a changed immutable creation replay under the exact identity', async () => {
    const { repository } = fixture();
    await repository.createOrGet(pendingInput());

    await expect(
      repository.createOrGet(
        pendingInput({ toolName: 'create_calendar_event' as const })
      )
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
  });

  it('resolves and reads a confirmation using a padded Meta transport message id', async () => {
    const { repository } = fixture();
    await repository.createOrGet(pendingInput());

    await expect(
      repository.resolveExact({
        identity: identity(),
        decision: 'confirm',
        resolutionMessageId: paddedWamid,
        now: '2026-07-20T10:01:00.000Z',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      confirmation: {
        state: 'resolved',
        decision: 'confirm',
        resolutionMessageId: paddedWamid,
      },
    });
    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toMatchObject({
      ok: true,
      confirmation: { resolutionMessageId: paddedWamid },
    });
  });

  it.each([
    ['non-object JSON', '[]'],
    ['non-canonical JSON', '{"b":1,"a":2}'],
    ['oversized JSON', JSON.stringify({ content: 'x'.repeat(65 * 1024) })],
  ])('rejects decrypted %s tool arguments', async (_name, plaintext) => {
    const { firestore, crypto, repository } = fixture();
    await repository.createOrGet(pendingInput());
    const ref = firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .doc('confirmation_1');
    const stored = (await ref.get()).data() as Record<string, unknown>;
    await ref.set({
      ...stored,
      encryptedToolArgs: crypto.encrypt(plaintext, {
        version: 1,
        kind: 'test_confirmation_tool_args',
        runtimeAudience: 'hetzner-prod',
        ...identity(),
        toolName: 'create_note',
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
        createdAt,
        expiresAt,
        state: 'pending',
        decision: null,
        resolutionMessageId: null,
        resolvedAt: null,
      }),
    });

    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_CONFIRMATION',
    });
  });

  it('rejects a non-object encrypted value with an otherwise exact stored shape', async () => {
    const { firestore, repository } = fixture();
    await repository.createOrGet(pendingInput());
    const ref = firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .doc('confirmation_1');
    const stored = (await ref.get()).data() as Record<string, unknown>;
    await ref.set({ ...stored, encryptedToolArgs: null });

    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_CONFIRMATION',
    });
  });

  it('rejects wrong run scenario session or fence without rewriting the first record', async () => {
    const { repository } = fixture();
    await repository.createOrGet(pendingInput());

    for (const changed of [
      identity({ runId: 'run_2' }),
      identity({ scenarioId: 'scenario_2' }),
      identity({ sessionId: 'session_2' }),
      identity({ userId: 'user_2' }),
      identity({ leaseFence: '8' }),
    ]) {
      await expect(
        repository.createOrGet(pendingInput({ identity: changed }))
      ).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
      await expect(repository.getExact({ ...changed, now: createdAt })).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
    }

    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toMatchObject({
      ok: true,
      confirmation: { ...identity(), createdAt },
    });
  });

  it('rejects an ordinary-lane or corrupt document instead of treating it as test authority', async () => {
    const { firestore, repository } = fixture();
    await firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .doc('confirmation_1')
      .set({
        version: 1,
        lane: 'ordinary',
        ...identity(),
        ...pendingInput(),
      });

    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toEqual({
      ok: false,
      code: 'INVALID_LANE',
    });
    await expect(repository.createOrGet(pendingInput())).resolves.toEqual({
      ok: false,
      code: 'INVALID_LANE',
    });
  });

  it('returns a closed not-found result and defensively clones returned records', async () => {
    const { repository } = fixture();
    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    const created = await repository.createOrGet(pendingInput());
    if (!created.ok) throw new Error('fixture create failed');
    created.confirmation.runId = 'mutated';

    await expect(repository.getExact({ ...identity(), now: createdAt })).resolves.toMatchObject({
      ok: true,
      confirmation: { runId: 'run_1' },
    });
  });

  it('rejects invalid create, read, and resolve inputs before persistence', async () => {
    const { repository } = fixture();

    await expect(
      repository.createOrGet(pendingInput({ selectionOrdinal: 0 }))
    ).resolves.toEqual({ ok: false, code: 'CORRUPT_CONFIRMATION' });
    await expect(repository.getExact({ ...identity(), now: 'invalid' })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_CONFIRMATION',
    });
    for (const invalid of [
      { now: 'invalid', resolutionMessageId: 'transport_confirmation_1' },
      { now: createdAt, resolutionMessageId: '' },
    ]) {
      await expect(
        repository.resolveExact({
          identity: identity(),
          decision: 'confirm',
          ...invalid,
        })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_CONFIRMATION' });
    }
    await expect(
      repository.resolveExact({
        identity: identity(),
        decision: 'confirm',
        resolutionMessageId: 'transport_confirmation_1',
        now: createdAt,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('rejects corrupt exact-key and extra-key confirmation documents during resolution', async () => {
    for (const corrupt of [
      {
        version: 1,
        lane: 'matrix_corpus',
        runtimeAudience: 'hetzner-prod',
        ...identity(),
        state: 'pending',
        toolName: 'create_note',
        toolArgs: {},
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
        createdAt,
        expiresAt,
        decision: null,
        resolutionMessageId: null,
        resolvedAt: null,
        extra: true,
      },
      {
        version: 2,
        lane: 'matrix_corpus',
        runtimeAudience: 'hetzner-prod',
        ...identity(),
        state: 'pending',
        toolName: 'create_note',
        toolArgs: {},
        selectionTurnIndex: 0,
        selectionOrdinal: 1,
        createdAt,
        expiresAt,
        decision: null,
        resolutionMessageId: null,
        resolvedAt: null,
      },
    ]) {
      const { firestore, repository } = fixture();
      await firestore
        .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
        .doc('confirmation_1')
        .set(corrupt);
      await expect(
        repository.resolveExact({
          identity: identity(),
          decision: 'confirm',
          resolutionMessageId: 'transport_confirmation_1',
          now: createdAt,
        })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_CONFIRMATION' });
    }
  });

  it('round-trips nested array tool arguments without aliasing', async () => {
    const { repository } = fixture();
    const created = await repository.createOrGet(
      pendingInput({ toolArgs: { items: [{ id: 'one' }, { id: 'two' }] } })
    );
    expect(created).toMatchObject({
      ok: true,
      confirmation: { toolArgs: { items: [{ id: 'one' }, { id: 'two' }] } },
    });
  });

  it('expires a pending confirmation at the exact deadline', async () => {
    const { repository } = fixture();
    await repository.createOrGet(pendingInput());

    await expect(
      repository.getExact({ ...identity(), now: '2026-07-20T10:04:59.999Z' })
    ).resolves.toMatchObject({ ok: true, confirmation: { state: 'pending' } });
    await expect(repository.getExact({ ...identity(), now: expiresAt })).resolves.toEqual({
      ok: false,
      code: 'EXPIRED',
    });
  });

  it.each(['confirm', 'reject'] as const)(
    'resolves an exact pending confirmation once with decision %s',
    async (decision) => {
      const { repository } = fixture();
      await repository.createOrGet(pendingInput());

      await expect(
        repository.resolveExact({
          identity: identity(),
          decision,
          resolutionMessageId: 'transport_confirmation_1',
          now: '2026-07-20T10:01:00.000Z',
        })
      ).resolves.toMatchObject({
        ok: true,
        disposition: 'applied',
        confirmation: {
          state: 'resolved',
          decision,
          resolutionMessageId: 'transport_confirmation_1',
          resolvedAt: '2026-07-20T10:01:00.000Z',
        },
      });
      await expect(
        repository.resolveExact({
          identity: identity(),
          decision,
          resolutionMessageId: 'transport_confirmation_1',
          now: '2026-07-20T10:01:00.000Z',
        })
      ).resolves.toMatchObject({
        ok: true,
        disposition: 'already_applied',
        confirmation: {
          state: 'resolved',
          decision,
          resolutionMessageId: 'transport_confirmation_1',
          resolvedAt: '2026-07-20T10:01:00.000Z',
        },
      });
    }
  );

  it.each([
    {
      decision: 'reject' as const,
      resolutionMessageId: 'transport_confirmation_1',
      now: '2026-07-20T10:01:00.000Z',
    },
    {
      decision: 'confirm' as const,
      resolutionMessageId: 'transport_confirmation_2',
      now: '2026-07-20T10:01:00.000Z',
    },
    {
      decision: 'confirm' as const,
      resolutionMessageId: 'transport_confirmation_1',
      now: '2026-07-20T10:01:00.001Z',
    },
  ])('rejects a changed replay after resolution: %#', async (changed) => {
    const { repository } = fixture();
    await repository.createOrGet(pendingInput());
    await repository.resolveExact({
      identity: identity(),
      decision: 'confirm',
      resolutionMessageId: 'transport_confirmation_1',
      now: '2026-07-20T10:01:00.000Z',
    });

    await expect(
      repository.resolveExact({ identity: identity(), ...changed })
    ).resolves.toEqual({ ok: false, code: 'ALREADY_RESOLVED' });
  });

  it('rejects expired and cross-lane resolutions without changing the pending record', async () => {
    const { repository } = fixture();
    await repository.createOrGet(pendingInput());

    await expect(
      repository.resolveExact({
        identity: identity({ runId: 'run_2' }),
        decision: 'confirm',
        resolutionMessageId: 'transport_confirmation_1',
        now: '2026-07-20T10:01:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    await expect(
      repository.resolveExact({
        identity: identity(),
        decision: 'confirm',
        resolutionMessageId: 'transport_confirmation_1',
        now: expiresAt,
      })
    ).resolves.toEqual({ ok: false, code: 'EXPIRED' });
    await expect(
      repository.getExact({ ...identity(), now: '2026-07-20T10:04:00.000Z' })
    ).resolves.toMatchObject({ ok: true, confirmation: { state: 'pending' } });
  });
});
