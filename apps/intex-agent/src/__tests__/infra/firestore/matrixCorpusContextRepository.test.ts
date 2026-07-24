import { createHash } from 'node:crypto';

import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { describe, expect, it } from 'vitest';

import {
  createMatrixCorpusContextCrypto,
  type MatrixCorpusEncryptedValueV1,
} from '../../../domain/matrixCorpus/contextCrypto.js';
import type {
  MatrixCorpusContextIdentity,
  MatrixCorpusPrivateRunContextV1,
  MatrixCorpusPrivateScenarioContextV1,
} from '../../../domain/matrixCorpus/ports/matrixCorpusContextRepository.js';
import type { MatrixCorpusRunManifestV1 } from '../../../domain/matrixCorpus/ports/matrixCorpusManifestRepository.js';
import {
  FirestoreMatrixCorpusContextRepository,
  INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION,
  INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION,
  parseMatrixCorpusRunContextDocument,
  parseMatrixCorpusScenarioContextDocument,
} from '../../../infra/firestore/matrixCorpusContextRepository.js';
import { FirestoreMatrixCorpusManifestRepository } from '../../../infra/firestore/matrixCorpusManifestRepository.js';

const createdAt = '2026-07-20T10:00:00.000Z';
const expiresAt = '2026-07-21T10:00:00.000Z';

function crypto(): ReturnType<typeof createMatrixCorpusContextCrypto> {
  return createMatrixCorpusContextCrypto({
    key: Buffer.alloc(32, 7),
    keyVersion: 'context-key-v1',
    randomBytes: () => Buffer.alloc(12, 3),
  });
}

function encryptedRunPrompt(plaintext = 'private baseline'): MatrixCorpusEncryptedValueV1 {
  return crypto().encrypt(plaintext, {
    version: 1,
    kind: 'run_prompt_context',
    runtimeAudience: 'hetzner-prod',
    runId: 'run_1',
    userId: 'auth0:user_1',
    leaseFence: '7',
  });
}

function encryptedScenarioPrompt(
  scenarioId = 'scenario_001',
  plaintext = 'private effective'
): MatrixCorpusEncryptedValueV1 {
  return crypto().encrypt(plaintext, {
    version: 1,
    kind: 'scenario_prompt_context',
    runtimeAudience: 'hetzner-prod',
    runId: 'run_1',
    scenarioId,
    userId: 'auth0:user_1',
    leaseFence: '7',
  });
}

function runContext(
  overrides: Readonly<Record<string, unknown>> = {}
): MatrixCorpusPrivateRunContextV1 {
  return {
    version: 1 as const,
    status: 'active' as const,
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'auth0:user_1',
    leaseFence: '7',
    catalogDigest: 'a'.repeat(64),
    agentModel: 'or:deepseek/deepseek-v4-flash' as const,
    evaluatorModel: 'or:minimax/minimax-m3' as const,
    promptPreferencesVersion: 2,
    promptPreferencesDigest: 'b'.repeat(64),
    encryptedPromptContext: encryptedRunPrompt(),
    userTimeZone: 'Europe/Warsaw',
    createdAt,
    expiresAt,
    invalidatedAt: null,
    ...overrides,
  } as MatrixCorpusPrivateRunContextV1;
}

function scenarioContext(
  scenarioNumber = 1,
  overrides: Readonly<Record<string, unknown>> = {}
): MatrixCorpusPrivateScenarioContextV1 {
  const scenarioId = `scenario_${String(scenarioNumber).padStart(3, '0')}`;
  return {
    version: 1 as const,
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    scenarioId,
    userId: 'auth0:user_1',
    leaseFence: '7',
    baselinePromptPreferencesDigest: 'b'.repeat(64),
    overlayVersion: 0,
    overlayDigest: 'c'.repeat(64),
    encryptedEffectivePromptContext: encryptedScenarioPrompt(scenarioId),
    lastAppliedMutationReceipt: null,
    expiresAt,
    invalidatedAt: null,
    ...overrides,
  } as MatrixCorpusPrivateScenarioContextV1;
}

function identity(): MatrixCorpusContextIdentity {
  return { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' };
}

function runManifest(
  overrides: Readonly<Record<string, unknown>> = {}
): MatrixCorpusRunManifestV1 {
  return {
    version: 1 as const,
    runtimeAudience: 'hetzner-prod' as const,
    ...identity(),
    catalogDigest: 'a'.repeat(64),
    scenarioBindings: [],
    artifactStage: null,
    terminalCandidate: null,
    createdAt,
    ...overrides,
  } as MatrixCorpusRunManifestV1;
}

function fixture(): Readonly<{
  firestore: Firestore;
  repository: FirestoreMatrixCorpusContextRepository;
  manifestRepository: FirestoreMatrixCorpusManifestRepository;
}> {
  const firestore = createFakeFirestore() as unknown as Firestore;
  return {
    firestore,
    repository: new FirestoreMatrixCorpusContextRepository({ firestore }),
    manifestRepository: new FirestoreMatrixCorpusManifestRepository({ firestore }),
  };
}

describe('FirestoreMatrixCorpusContextRepository', () => {
  it('parses only exact valid run, scenario, finalization, and encrypted context shapes', () => {
    expect(parseMatrixCorpusRunContextDocument(runContext())).toEqual(runContext());
    expect(
      parseMatrixCorpusRunContextDocument(
        runContext({ agentModel: 'or:minimax/minimax-m3' })
      )
    ).toEqual(runContext({ agentModel: 'or:minimax/minimax-m3' }));
    expect(
      parseMatrixCorpusRunContextDocument(
        runContext({ encryptedPromptContext: encryptedRunPrompt('') })
      )
    ).toBeDefined();
    for (const invalid of [
      null,
      [],
      { ...runContext(), extra: true },
      runContext({ version: 2 }),
      runContext({ status: 'invalid' }),
      runContext({ runtimeAudience: 'production' }),
      runContext({ runId: '' }),
      runContext({ userId: '' }),
      runContext({ leaseFence: '0' }),
      runContext({ catalogDigest: 'invalid' }),
      runContext({ agentModel: 'or:google/gemini-3-flash-preview' }),
      runContext({ evaluatorModel: 'or:deepseek/deepseek-v4-flash' }),
      runContext({ promptPreferencesVersion: 1.5 }),
      runContext({ promptPreferencesVersion: -1 }),
      runContext({ promptPreferencesDigest: 'invalid' }),
      runContext({ encryptedPromptContext: { ...encryptedRunPrompt(), extra: true } }),
      runContext({ encryptedPromptContext: { ...encryptedRunPrompt(), algorithm: 'invalid' } }),
      runContext({ encryptedPromptContext: { ...encryptedRunPrompt(), keyVersion: '' } }),
      runContext({ encryptedPromptContext: { ...encryptedRunPrompt(), nonce: 'A' } }),
      runContext({ encryptedPromptContext: { ...encryptedRunPrompt(), nonce: '***' } }),
      runContext({ encryptedPromptContext: { ...encryptedRunPrompt(), nonce: 'AA' } }),
      runContext({ encryptedPromptContext: { ...encryptedRunPrompt(), authenticationTag: 'AA' } }),
      runContext({ encryptedPromptContext: { ...encryptedRunPrompt(), ciphertext: 'A'.repeat(26_668) } }),
      runContext({ userTimeZone: 'Invalid/Zone' }),
      runContext({ createdAt: 'invalid' }),
      runContext({ expiresAt: 'invalid' }),
      runContext({ expiresAt: '2026-07-21T09:59:59.999Z' }),
      runContext({ invalidatedAt: 'invalid' }),
    ])
      expect(parseMatrixCorpusRunContextDocument(invalid)).toBeUndefined();

    const finalized = {
      version: 1 as const,
      status: 'finalized' as const,
      runtimeAudience: 'hetzner-prod' as const,
      ...identity(),
      scenarioContextCount: 1,
      finalizedAt: createdAt,
    };
    expect(parseMatrixCorpusRunContextDocument(finalized)).toEqual(finalized);
    for (const invalid of [
      { ...finalized, version: 2 },
      { ...finalized, status: 'active' },
      { ...finalized, runtimeAudience: 'production' },
      { ...finalized, runId: '' },
      { ...finalized, scenarioContextCount: 1.5 },
      { ...finalized, scenarioContextCount: -1 },
      { ...finalized, scenarioContextCount: 21 },
      { ...finalized, finalizedAt: 'invalid' },
    ])
      expect(parseMatrixCorpusRunContextDocument(invalid)).toBeUndefined();

    expect(parseMatrixCorpusScenarioContextDocument(scenarioContext())).toEqual(
      scenarioContext()
    );
    for (const invalid of [
      null,
      { ...scenarioContext(), extra: true },
      scenarioContext(1, { version: 2 }),
      scenarioContext(1, { runtimeAudience: 'production' }),
      scenarioContext(1, { runId: '' }),
      scenarioContext(1, { scenarioId: '' }),
      scenarioContext(1, { baselinePromptPreferencesDigest: 'invalid' }),
      scenarioContext(1, { overlayVersion: 1.5 }),
      scenarioContext(1, { overlayVersion: -1 }),
      scenarioContext(1, { overlayDigest: 'invalid' }),
      scenarioContext(1, { encryptedEffectivePromptContext: { ...encryptedScenarioPrompt(), nonce: 'AA' } }),
      scenarioContext(1, { lastAppliedMutationReceipt: '' }),
      scenarioContext(1, { expiresAt: 'invalid' }),
      scenarioContext(1, { invalidatedAt: 'invalid' }),
    ])
      expect(parseMatrixCorpusScenarioContextDocument(invalid)).toBeUndefined();
  });

  it('rejects context registration after durable abandoned recovery', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_matrix_corpus_recovery_receipts').doc('run_1').set({
      version: 1,
      runtimeAudience: 'hetzner-prod',
      ...identity(),
      eventId: 'abandoned_event_1',
      payloadDigest: 'f'.repeat(64),
      outcome: 'provisioning_noop',
      acknowledgedAt: createdAt,
    });

    await expect(
      repository.registerRunContextAndManifest({
        context: runContext(),
        manifest: runManifest(),
      })
    ).resolves.toEqual({ ok: false, code: 'FINALIZED' });
    await expect(repository.registerRunContext(runContext())).resolves.toEqual({
      ok: false,
      code: 'FINALIZED',
    });
    await expect(repository.registerScenarioContext(scenarioContext())).resolves.toEqual({
      ok: false,
      code: 'FINALIZED',
    });
    const context = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc('run_1')
      .get();
    expect(context.exists).toBe(false);
  });

  it('atomically registers the encrypted run context and its empty manifest', async () => {
    const { firestore, repository } = fixture();

    await expect(
      repository.registerRunContextAndManifest({
        context: runContext(),
        manifest: runManifest(),
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'applied' });
    await expect(
      repository.registerRunContextAndManifest({
        context: runContext(),
        manifest: runManifest(),
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'already_applied' });
    await expect(
      firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').get()
    ).resolves.toMatchObject({ exists: true });
    await expect(
      firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').get()
    ).resolves.toMatchObject({ exists: true });
  });

  it('rejects an invalid atomic run-context and manifest proposal before transaction work', async () => {
    const { repository } = fixture();

    await expect(
      repository.registerRunContextAndManifest({
        context: runContext({ runId: '' }),
        manifest: runManifest(),
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('does not persist context when the correlated manifest conflicts', async () => {
    const { firestore, repository } = fixture();
    await firestore
      .collection('intex_agent_matrix_corpus_run_manifests')
      .doc('run_1')
      .set(runManifest({ catalogDigest: 'd'.repeat(64) }));

    await expect(
      repository.registerRunContextAndManifest({
        context: runContext(),
        manifest: runManifest(),
      })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    await expect(
      firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').get()
    ).resolves.toMatchObject({ exists: false });
  });

  it('registers closed encrypted run and scenario context without plaintext leakage', async () => {
    const { firestore, repository } = fixture();

    await expect(repository.registerRunContext(runContext())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
    });
    await expect(repository.registerScenarioContext(scenarioContext())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
    });

    const run = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc('run_1')
      .get();
    const scenarios = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
      .where('runId', '==', 'run_1')
      .get();
    expect(run.data()).toEqual(runContext());
    expect(scenarios.docs).toHaveLength(1);
    const serialized = JSON.stringify([run.data(), scenarios.docs[0]?.data()]);
    expect(serialized).not.toContain('private baseline');
    expect(serialized).not.toContain('private effective');
    expect(serialized).not.toContain('promptContext');
  });

  it('replays only byte-identical run/scenario registrations and rejects changed reuse', async () => {
    const { repository } = fixture();
    const firstRun = runContext();
    const firstScenario = scenarioContext();
    await repository.registerRunContext(firstRun);
    await repository.registerScenarioContext(firstScenario);

    await expect(repository.registerRunContext(firstRun)).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
    });
    await expect(repository.registerScenarioContext(firstScenario)).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
    });
    for (const changed of [
      runContext({ userTimeZone: 'UTC' }),
      runContext({ promptPreferencesDigest: 'd'.repeat(64) }),
      runContext({ encryptedPromptContext: encryptedRunPrompt('changed') }),
      runContext({ leaseFence: '8' }),
    ])
      await expect(repository.registerRunContext(changed as never)).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
    for (const changed of [
      scenarioContext(1, { overlayDigest: 'd'.repeat(64) }),
      scenarioContext(1, { encryptedEffectivePromptContext: encryptedScenarioPrompt('scenario_001', 'changed') }),
      scenarioContext(1, { leaseFence: '8' }),
    ])
      await expect(repository.registerScenarioContext(changed as never)).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
  });

  it('fails closed for corrupt, finalized, and incomplete context registration roots', async () => {
    {
      const { firestore, repository } = fixture();
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
        .doc('run_1')
        .set({ corrupt: true });
      await expect(
        repository.registerRunContextAndManifest({
          context: runContext(),
          manifest: runManifest(),
        })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_CONTEXT' });
    }
    {
      const { firestore, repository } = fixture();
      await firestore
        .collection('intex_agent_matrix_corpus_run_manifests')
        .doc('run_1')
        .set({ corrupt: true });
      await expect(
        repository.registerRunContextAndManifest({
          context: runContext(),
          manifest: runManifest(),
        })
      ).resolves.toEqual({ ok: false, code: 'MANIFEST_MISMATCH' });
    }
    {
      const { firestore, repository } = fixture();
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
        .doc('run_1')
        .set({
          version: 1,
          status: 'finalized',
          runtimeAudience: 'hetzner-prod',
          ...identity(),
          scenarioContextCount: 0,
          finalizedAt: createdAt,
        });
      await expect(
        repository.registerRunContextAndManifest({
          context: runContext(),
          manifest: runManifest(),
        })
      ).resolves.toEqual({ ok: false, code: 'FINALIZED' });
    }

    for (const context of [
      runContext({ runId: '' }),
      runContext({ status: 'finalized' }),
    ]) {
      const { repository } = fixture();
      await expect(repository.registerRunContext(context)).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
    }
    {
      const { firestore, repository } = fixture();
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
        .doc('run_1')
        .set({ corrupt: true });
      await expect(repository.registerRunContext(runContext())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_CONTEXT',
      });
    }
    {
      const { firestore, repository } = fixture();
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
        .doc('run_1')
        .set({
          version: 1,
          status: 'finalized',
          runtimeAudience: 'hetzner-prod',
          ...identity(),
          scenarioContextCount: 0,
          finalizedAt: createdAt,
        });
      await expect(repository.registerRunContext(runContext())).resolves.toEqual({
        ok: false,
        code: 'FINALIZED',
      });
      await expect(repository.registerScenarioContext(scenarioContext())).resolves.toEqual({
        ok: false,
        code: 'FINALIZED',
      });
      await expect(
        repository.getRunContext({ ...identity(), now: createdAt })
      ).resolves.toMatchObject({ ok: true, context: { status: 'finalized' } });
    }
  });

  it('validates every scenario registration dependency before persisting ciphertext', async () => {
    for (const invalid of [
      scenarioContext(1, { runId: '' }),
      scenarioContext(1, { scenarioId: '' }),
    ]) {
      const { repository } = fixture();
      await expect(repository.registerScenarioContext(invalid)).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
    }
    {
      const { repository } = fixture();
      await expect(repository.registerScenarioContext(scenarioContext())).resolves.toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
    }
    {
      const { firestore, repository } = fixture();
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
        .doc('run_1')
        .set({ corrupt: true });
      await expect(repository.registerScenarioContext(scenarioContext())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_CONTEXT',
      });
    }
    {
      const { repository } = fixture();
      await repository.registerRunContext(runContext());
      await expect(
        repository.registerScenarioContext(scenarioContext(1, { leaseFence: '8' }))
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
      await expect(
        repository.registerScenarioContext(
          scenarioContext(1, { baselinePromptPreferencesDigest: 'd'.repeat(64) })
        )
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
      await expect(
        repository.registerScenarioContext(
          scenarioContext(1, { expiresAt: '2026-07-22T10:00:00.000Z' })
        )
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
    }
    {
      const { firestore, repository } = fixture();
      await repository.registerRunContext(runContext());
      const scenarioId = 'scenario_001';
      const id = createHash('sha256')
        .update(`run_1\u0000${scenarioId}`, 'utf8')
        .digest('hex')
        .slice(0, 32);
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
        .doc(id)
        .set({ corrupt: true });
      await expect(repository.registerScenarioContext(scenarioContext())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_CONTEXT',
      });
    }
  });

  it('replaces one live scenario overlay with exact optimistic concurrency', async () => {
    const replacement = scenarioContext(1, {
      overlayVersion: 1,
      overlayDigest: 'd'.repeat(64),
      encryptedEffectivePromptContext: encryptedScenarioPrompt('scenario_001', 'changed'),
      lastAppliedMutationReceipt: 'mutation_1',
    });
    const input = {
      identity: { ...identity(), scenarioId: 'scenario_001' },
      now: createdAt,
      expectedOverlayVersion: 0,
      expectedOverlayDigest: 'c'.repeat(64),
      context: replacement,
    };
    for (const invalid of [
      { ...input, identity: { ...input.identity, scenarioId: '' } },
      { ...input, now: 'invalid' },
      { ...input, expectedOverlayVersion: -1 },
      { ...input, expectedOverlayVersion: 0.5 },
      { ...input, expectedOverlayDigest: 'invalid' },
      { ...input, context: { ...replacement, leaseFence: '8' } },
      { ...input, context: { ...replacement, scenarioId: 'scenario_002' } },
    ]) {
      const { repository } = fixture();
      await expect(repository.replaceScenarioContext(invalid as never)).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
    }

    {
      const { repository } = fixture();
      await expect(repository.replaceScenarioContext(input)).resolves.toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
    }
    {
      const { firestore, repository } = fixture();
      await repository.registerRunContext(runContext());
      await repository.registerScenarioContext(scenarioContext());
      const scenarioId = createHash('sha256')
        .update('run_1\u0000scenario_001', 'utf8')
        .digest('hex')
        .slice(0, 32);
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
        .doc(scenarioId)
        .set({ corrupt: true });
      await expect(repository.replaceScenarioContext(input)).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_CONTEXT',
      });
    }
    {
      const { repository } = fixture();
      await repository.registerRunContext(runContext());
      await repository.registerScenarioContext(scenarioContext());
      await expect(
        repository.replaceScenarioContext({ ...input, expectedOverlayVersion: 1 })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
      await expect(
        repository.replaceScenarioContext({ ...input, expectedOverlayDigest: 'e'.repeat(64) })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
      await expect(
        repository.replaceScenarioContext({
          ...input,
          context: { ...replacement, overlayVersion: 2 },
        })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
      await expect(repository.replaceScenarioContext(input)).resolves.toMatchObject({
        ok: true,
        disposition: 'applied',
        context: { overlayVersion: 1, lastAppliedMutationReceipt: 'mutation_1' },
      });
    }
  });

  it('fails closed across recovery, ownership, lifetime, and root failures during replacement', async () => {
    const replacement = scenarioContext(1, {
      overlayVersion: 1,
      overlayDigest: 'd'.repeat(64),
      encryptedEffectivePromptContext: encryptedScenarioPrompt('scenario_001', 'changed'),
      lastAppliedMutationReceipt: 'mutation_1',
    });
    const input = {
      identity: { ...identity(), scenarioId: 'scenario_001' },
      now: createdAt,
      expectedOverlayVersion: 0,
      expectedOverlayDigest: 'c'.repeat(64),
      context: replacement,
    };
    const scenarioDocumentId = createHash('sha256')
      .update('run_1\u0000scenario_001', 'utf8')
      .digest('hex')
      .slice(0, 32);

    {
      const { firestore, repository } = fixture();
      await repository.registerRunContext(runContext());
      await repository.registerScenarioContext(scenarioContext());
      await firestore
        .collection('intex_agent_matrix_corpus_recovery_receipts')
        .doc('run_1')
        .set({ terminal: true });
      await expect(repository.replaceScenarioContext(input)).resolves.toEqual({
        ok: false,
        code: 'FINALIZED',
      });
    }
    {
      const { repository } = fixture();
      await repository.registerRunContext(runContext());
      await expect(repository.replaceScenarioContext(input)).resolves.toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
    }
    {
      const { firestore, repository } = fixture();
      await repository.registerRunContext(runContext());
      await repository.registerScenarioContext(scenarioContext());
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
        .doc('run_1')
        .set({ corrupt: true });
      await expect(repository.replaceScenarioContext(input)).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_CONTEXT',
      });
    }
    {
      const { firestore, repository } = fixture();
      await repository.registerRunContext(runContext());
      await repository.registerScenarioContext(scenarioContext());
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
        .doc('run_1')
        .set({
          version: 1,
          status: 'finalized',
          runtimeAudience: 'hetzner-prod',
          ...identity(),
          scenarioContextCount: 1,
          finalizedAt: createdAt,
        });
      await expect(repository.replaceScenarioContext(input)).resolves.toEqual({
        ok: false,
        code: 'FINALIZED',
      });
    }
    for (const mutation of [
      { userId: 'auth0:foreign' },
      { invalidatedAt: createdAt },
    ]) {
      const { firestore, repository } = fixture();
      await repository.registerRunContext(runContext());
      await repository.registerScenarioContext(scenarioContext());
      const ref = firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
        .doc(scenarioDocumentId);
      const snapshot = await ref.get();
      await ref.set({ ...snapshot.data(), ...mutation });
      await expect(repository.replaceScenarioContext(input)).resolves.toEqual({
        ok: false,
        code:
          'userId' in mutation ? 'CORRELATED_REPLAY_CONFLICT' : 'INVALIDATED',
      });
    }
    {
      const { repository } = fixture();
      await repository.registerRunContext(runContext());
      await repository.registerScenarioContext(scenarioContext());
      await expect(
        repository.replaceScenarioContext({ ...input, now: expiresAt })
      ).resolves.toEqual({ ok: false, code: 'EXPIRED' });
    }
  });

  it('fails closed on invalid, missing, corrupt, foreign, and invalidated scenario reads', async () => {
    const valid = { ...identity(), scenarioId: 'scenario_001', now: createdAt };
    {
      const { repository } = fixture();
      await expect(
        repository.getRunContext({ ...identity(), now: 'invalid' })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
      await expect(
        repository.getScenarioContext({ ...valid, scenarioId: '' })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
      await expect(repository.getScenarioContext(valid)).resolves.toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
    }
    {
      const { firestore, repository } = fixture();
      const scenarioDocumentId = createHash('sha256')
        .update('run_1\u0000scenario_001', 'utf8')
        .digest('hex')
        .slice(0, 32);
      const ref = firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
        .doc(scenarioDocumentId);
      await ref.set({ corrupt: true });
      await expect(repository.getScenarioContext(valid)).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_CONTEXT',
      });
      await ref.set(scenarioContext(1, { userId: 'auth0:foreign' }));
      await expect(repository.getScenarioContext(valid)).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
      await ref.set(scenarioContext(1, { invalidatedAt: createdAt }));
      await expect(repository.getScenarioContext(valid)).resolves.toEqual({
        ok: false,
        code: 'INVALIDATED',
      });
    }
    {
      const { firestore, repository } = fixture();
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
        .doc('run_1')
        .set(runContext({ invalidatedAt: createdAt }));
      await expect(repository.getRunContext({ ...identity(), now: createdAt })).resolves.toEqual({
        ok: false,
        code: 'INVALIDATED',
      });
    }
  });

  it('validates finalization roots and manifest identity before deleting scenarios', async () => {
    await expect(
      fixture().repository.finalizeRunContext({ ...identity(), now: 'invalid' })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });

    {
      const { repository } = fixture();
      await expect(
        repository.finalizeRunContext({ ...identity(), now: createdAt })
      ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    }
    {
      const { firestore, repository } = fixture();
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
        .doc('run_1')
        .set({ corrupt: true });
      await expect(
        repository.finalizeRunContext({ ...identity(), now: createdAt })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_CONTEXT' });
    }
    {
      const { firestore, repository } = fixture();
      await firestore
        .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
        .doc('run_1')
        .set(runContext({ userId: 'auth0:foreign' }));
      await expect(
        repository.finalizeRunContext({ ...identity(), now: createdAt })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    }
    {
      const { repository } = fixture();
      await repository.registerRunContext(runContext({ invalidatedAt: createdAt }));
      await expect(
        repository.finalizeRunContext({ ...identity(), now: createdAt })
      ).resolves.toEqual({ ok: false, code: 'INVALIDATED' });
    }
    {
      const { repository } = fixture();
      await repository.registerRunContext(runContext());
      await expect(
        repository.finalizeRunContext({ ...identity(), now: createdAt })
      ).resolves.toEqual({ ok: false, code: 'MANIFEST_MISMATCH' });
    }
    for (const manifest of [
      { corrupt: true },
      runManifest({ userId: 'auth0:foreign' }),
    ]) {
      const { firestore, repository } = fixture();
      await repository.registerRunContext(runContext());
      await firestore
        .collection('intex_agent_matrix_corpus_run_manifests')
        .doc('run_1')
        .set(manifest);
      await expect(
        repository.finalizeRunContext({ ...identity(), now: createdAt })
      ).resolves.toEqual({ ok: false, code: 'MANIFEST_MISMATCH' });
    }
  });

  it('loads only the exact live fence and closes at the absolute expiry boundary', async () => {
    const { repository } = fixture();
    await repository.registerRunContext(runContext());
    await repository.registerScenarioContext(scenarioContext());

    await expect(
      repository.getRunContext({ ...identity(), now: '2026-07-21T09:59:59.999Z' })
    ).resolves.toMatchObject({ ok: true, context: { status: 'active' } });
    await expect(
      repository.getScenarioContext({
        ...identity(),
        scenarioId: 'scenario_001',
        now: '2026-07-21T09:59:59.999Z',
      })
    ).resolves.toMatchObject({ ok: true, context: { scenarioId: 'scenario_001' } });
    await expect(
      repository.getRunContext({ ...identity(), leaseFence: '8', now: createdAt })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    await expect(
      repository.getRunContext({ ...identity(), now: expiresAt })
    ).resolves.toEqual({ ok: false, code: 'EXPIRED' });
    await expect(
      repository.getScenarioContext({ ...identity(), scenarioId: 'scenario_001', now: expiresAt })
    ).resolves.toEqual({ ok: false, code: 'EXPIRED' });
  });

  it('atomically finalizes the manifest-recorded closed scenario set and replays the tombstone', async () => {
    const { firestore, repository, manifestRepository } = fixture();
    await repository.registerRunContext(runContext());
    await manifestRepository.createOrGet({
      version: 1,
      runtimeAudience: 'hetzner-prod',
      ...identity(),
      catalogDigest: 'a'.repeat(64),
      scenarioBindings: [],
      artifactStage: null,
      terminalCandidate: null,
      createdAt,
    });
    for (let number = 1; number <= 2; number += 1) {
      await repository.registerScenarioContext(scenarioContext(number));
      await manifestRepository.appendScenarioBinding({
        identity: identity(),
        binding: {
          scenarioId: `scenario_${String(number).padStart(3, '0')}`,
          scenarioNumber: number,
          scenarioLabel: `Scenario ${String(number).padStart(3, '0')}/020`,
          sessionId: `session_${String(number)}`,
        },
      });
    }

    const finalizedAt = '2026-07-20T12:00:00.000Z';
    await expect(
      repository.finalizeRunContext({ ...identity(), now: finalizedAt })
    ).resolves.toEqual({
      ok: true,
      disposition: 'applied',
      context: {
        version: 1,
        status: 'finalized',
        runtimeAudience: 'hetzner-prod',
        ...identity(),
        scenarioContextCount: 2,
        finalizedAt,
      },
    });
    const scenarios = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
      .where('runId', '==', 'run_1')
      .get();
    expect(scenarios.empty).toBe(true);
    await expect(
      repository.finalizeRunContext({ ...identity(), now: '2026-07-20T13:00:00.000Z' })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
      context: { finalizedAt },
    });
  });

  it('rejects first finalization at expiry but permits replay of an existing tombstone later', async () => {
    const { repository, manifestRepository } = fixture();
    await repository.registerRunContext(runContext());
    await manifestRepository.createOrGet(runManifest());

    await expect(
      repository.finalizeRunContext({ ...identity(), now: expiresAt })
    ).resolves.toEqual({ ok: false, code: 'EXPIRED' });
    await expect(
      repository.finalizeRunContext({
        ...identity(),
        now: '2026-07-20T23:59:59.999Z',
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'applied' });
    await expect(
      repository.finalizeRunContext({
        ...identity(),
        now: '2026-07-22T10:00:00.000Z',
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'already_applied' });
  });

  it('rejects finalization for missing, extra, corrupt, or mismatched scenario context', async () => {
    const { firestore, repository, manifestRepository } = fixture();
    await repository.registerRunContext(runContext());
    await manifestRepository.createOrGet({
      version: 1,
      runtimeAudience: 'hetzner-prod',
      ...identity(),
      catalogDigest: 'a'.repeat(64),
      scenarioBindings: [],
      artifactStage: null,
      terminalCandidate: null,
      createdAt,
    });
    await manifestRepository.appendScenarioBinding({
      identity: identity(),
      binding: {
        scenarioId: 'scenario_001',
        scenarioNumber: 1,
        scenarioLabel: 'Scenario 001/020',
        sessionId: 'session_1',
      },
    });

    await expect(
      repository.finalizeRunContext({ ...identity(), now: '2026-07-20T12:00:00.000Z' })
    ).resolves.toEqual({ ok: false, code: 'MANIFEST_MISMATCH' });
    await repository.registerScenarioContext(scenarioContext());
    await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
      .doc('extra')
      .set(scenarioContext(2));
    await expect(
      repository.finalizeRunContext({ ...identity(), now: '2026-07-20T12:00:00.000Z' })
    ).resolves.toEqual({ ok: false, code: 'MANIFEST_MISMATCH' });
    const run = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc('run_1')
      .get();
    expect(run.data()).toEqual(runContext());

    const mismatch = fixture();
    await mismatch.repository.registerRunContext(runContext());
    await mismatch.manifestRepository.createOrGet(runManifest());
    await mismatch.manifestRepository.appendScenarioBinding({
      identity: identity(),
      binding: {
        scenarioId: 'scenario_001',
        scenarioNumber: 1,
        scenarioLabel: 'Scenario 001/020',
        sessionId: 'session_1',
      },
    });
    await mismatch.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
      .doc('scenario_001')
      .set(scenarioContext(1, { baselinePromptPreferencesDigest: 'd'.repeat(64) }));
    await expect(
      mismatch.repository.finalizeRunContext({
        ...identity(),
        now: '2026-07-20T12:00:00.000Z',
      })
    ).resolves.toEqual({ ok: false, code: 'MANIFEST_MISMATCH' });
  });

  it('fails closed for missing or corrupt context and defensively clones returned values', async () => {
    const { firestore, repository } = fixture();
    await expect(repository.getRunContext({ ...identity(), now: createdAt })).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    const created = await repository.registerRunContext(runContext());
    if (!created.ok) throw new Error('fixture create failed');
    if (created.context.status !== 'active') throw new Error('fixture context finalized');
    created.context.encryptedPromptContext.ciphertext = 'mutated';
    await expect(repository.getRunContext({ ...identity(), now: createdAt })).resolves.toMatchObject({
      ok: true,
      context: { encryptedPromptContext: { ciphertext: runContext().encryptedPromptContext.ciphertext } },
    });

    await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc('run_1')
      .set({ ...runContext(), extra: 'unsafe' });
    await expect(repository.getRunContext({ ...identity(), now: createdAt })).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_CONTEXT',
    });
  });
});
