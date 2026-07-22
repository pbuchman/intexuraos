import { createHash } from 'node:crypto';

import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { canonicalMatrixCorpusStrictToolMockProfileV1 } from '@intexuraos/http-contracts';
import { describe, expect, it, vi } from 'vitest';

import type {
  MatrixCorpusPrivateRunContextV1,
  MatrixCorpusPrivateScenarioContextV1,
} from '../../../domain/matrixCorpus/ports/matrixCorpusContextRepository.js';
import { createMatrixCorpusContextCrypto } from '../../../domain/matrixCorpus/contextCrypto.js';
import type {
  MatrixCorpusRunManifestV1,
  MatrixCorpusTerminalCandidateV1,
} from '../../../domain/matrixCorpus/ports/matrixCorpusManifestRepository.js';
import type {
  TestRunIdentity,
  TestRunRepository,
} from '../../../domain/testRuns/ports/testRunRepository.js';
import type {
  IntexAgentTestRunRecordV1,
  TestRunProjectionCasCommandV1,
} from '../../../domain/testRuns/types.js';
import { digestArtifactCandidates } from '../../../domain/testRuns/stateMachine.js';
import {
  emptyDeterministicEvidence,
  testRunRecord,
  testRunScenario,
} from '../../domain/testRuns/testRunFixtures.js';
import { FirestoreTestRunRepository } from '../../../infra/firestore/testRunRepository.js';
import { FirestoreTestConfirmationRepository } from '../../../infra/firestore/testConfirmationRepository.js';

const later = '2026-07-20T10:05:00.000Z';

function identity(): TestRunIdentity {
  return { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' };
}

function contextCrypto(): ReturnType<typeof createMatrixCorpusContextCrypto> {
  return createMatrixCorpusContextCrypto({
    key: Buffer.alloc(32, 7),
    keyVersion: 'context-key-v1',
  });
}

function cleanupInput(): Parameters<TestRunRepository['cleanupExactRun']>[0] {
  return {
    currentIdentity: { runId: 'run_current', userId: 'auth0:user_1', leaseFence: '8' },
    targetIdentity: { runId: 'run_target', userId: 'auth0:user_1', leaseFence: '7' },
    updatedAt: later,
  };
}

function fixture(): Readonly<{
  firestore: Firestore;
  repository: FirestoreTestRunRepository;
}> {
  const firestore = createFakeFirestore() as unknown as Firestore;
  return {
    firestore,
    repository: new FirestoreTestRunRepository({ firestore, crypto: contextCrypto() }),
  };
}

describe('Firestore Test Run foundation repository', () => {
  it('rejects every malformed identity and cleanup correlation tuple before Firestore access', async () => {
    const { repository } = fixture();
    for (const invalidIdentity of [
      { runId: '', userId: 'auth0:user_1', leaseFence: '7' },
      { runId: 'run_1', userId: '', leaseFence: '7' },
      { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '0' },
    ])
      await expect(repository.getExact(invalidIdentity)).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });

    const validCleanup = {
      currentIdentity: { runId: 'run_current', userId: 'auth0:user_1', leaseFence: '8' },
      targetIdentity: { runId: 'run_target', userId: 'auth0:user_1', leaseFence: '7' },
      updatedAt: later,
    };
    for (const invalid of [
      { ...validCleanup, currentIdentity: { ...validCleanup.currentIdentity, runId: '' } },
      { ...validCleanup, targetIdentity: { ...validCleanup.targetIdentity, userId: '' } },
      { ...validCleanup, updatedAt: 'not-a-time' },
      {
        ...validCleanup,
        targetIdentity: { ...validCleanup.targetIdentity, userId: 'auth0:other' },
      },
      {
        ...validCleanup,
        targetIdentity: { ...validCleanup.targetIdentity, runId: 'run_current' },
      },
      {
        ...validCleanup,
        targetIdentity: { ...validCleanup.targetIdentity, leaseFence: '8' },
      },
    ])
      await expect(repository.cleanupExactRun(invalid)).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
  });

  it('fails closed across invalid and corrupt bounded read surfaces', async () => {
    const { firestore, repository } = fixture();
    await expect(repository.getCurrentAcceptance('')).resolves.toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    await expect(repository.listLatestForUser('')).resolves.toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    await expect(
      repository.listStagedArtifactsFinishedBefore({ cutoff: 'invalid', limit: 20 })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
    await expect(
      repository.listStagedArtifactsFinishedBefore({ cutoff: later, limit: 19 as 20 })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
    await firestore.collection('intex_agent_test_runs').doc('run_corrupt').set({
      userId: 'auth0:user_1',
      runtimeAudience: 'hetzner-prod',
      startedAt: later,
      artifactDelivery: { status: 'staged' },
      finishedAt: later,
    });
    await expect(repository.getCurrentAcceptance('auth0:user_1')).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_RECORD',
    });
    await expect(repository.listLatestForUser('auth0:user_1')).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_RECORD',
    });
    await expect(
      repository.listStagedArtifactsFinishedBefore({ cutoff: later, limit: 20 })
    ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECORD' });
  });

  it('covers owner reads, recovery locks, and corrupt create replays without data leaks', async () => {
    const { firestore, repository } = fixture();
    await expect(repository.getOwned('', 'auth0:user_1')).resolves.toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    await expect(repository.getOwned('run_missing', 'auth0:user_1')).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    await firestore.collection('intex_agent_test_runs').doc('run_1').set({ corrupt: true });
    await expect(repository.getOwned('run_1', 'auth0:user_1')).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_RECORD',
    });
    await expect(repository.createOrGet(testRunRecord())).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_RECORD',
    });
    await firestore.collection('intex_agent_test_runs').doc('run_1').delete();
    await firestore
      .collection('intex_agent_matrix_corpus_recovery_receipts')
      .doc('run_1')
      .set({ terminal: true });
    await expect(repository.createOrGet(testRunRecord())).resolves.toEqual({
      ok: false,
      code: 'TERMINAL_CONFLICT',
    });
  });

  it('rejects non-preflight create shapes before transaction entry', async () => {
    const { repository } = fixture();
    for (const record of [
      { ...testRunRecord(), extra: true },
      testRunRecord({ lifecycle: 'running' }),
      testRunRecord({ revision: 1 }),
      testRunRecord({ terminalCandidate: terminalCandidate() }),
      testRunRecord({
        lifecycle: 'completed',
        verdict: 'passed',
        finishedAt: later,
        terminalWinner: {
          kind: 'release',
          eventId: 'terminal_event_1',
          payloadDigest: 'f'.repeat(64),
          outcome: 'completed_passed',
          acknowledgedAt: later,
        },
      }),
    ])
      await expect(repository.createOrGet(record as never)).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
    await expect(
      repository.createOrGet({
        ...testRunRecord(),
        oversized: 'x'.repeat(70_000),
      } as never)
    ).resolves.toEqual({ ok: false, code: 'DOCUMENT_TOO_LARGE' });
  });

  it('uses the exact four-record owner/audience retention query in newest-first order', async () => {
    const { firestore, repository } = fixture();
    for (let index = 1; index <= 5; index += 1) {
      const runId = `run_${String(index)}`;
      await firestore.collection('intex_agent_test_runs').doc(runId).set(
        testRunRecord({
          runId,
          startedAt: `2026-07-20T10:0${String(index)}:00.000Z`,
          updatedAt: `2026-07-20T10:0${String(index)}:00.000Z`,
        })
      );
    }

    await expect(repository.listLatestForUser('auth0:user_1')).resolves.toMatchObject({
      ok: true,
      records: [
        { runId: 'run_5' },
        { runId: 'run_4' },
        { runId: 'run_3' },
        { runId: 'run_2' },
      ],
    });
    await expect(repository.listLatestForUser('auth0:user_1', 3 as 4)).resolves.toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  });

  it('uses the exact bounded staged-artifact deadline query in oldest-first order', async () => {
    const { firestore, repository } = fixture();
    const staged = (
      runId: string,
      finishedAt: string
    ): ReturnType<typeof testRunRecord> =>
      testRunRecord({
        runId,
        revision: 5,
        lifecycle: 'completed',
        verdict: 'passed',
        artifactDelivery: { status: 'staged', failureCode: null, updatedAt: finishedAt },
        finishedAt,
        updatedAt: finishedAt,
        terminalWinner: {
          kind: 'release',
          eventId: `terminal_${runId}`,
          payloadDigest: 'f'.repeat(64),
          outcome: 'completed_passed',
          acknowledgedAt: finishedAt,
        },
      });
    await firestore.collection('intex_agent_test_runs').doc('run_old').set(
      staged('run_old', '2026-07-20T10:00:00.000Z')
    );
    await firestore.collection('intex_agent_test_runs').doc('run_cutoff').set(
      staged('run_cutoff', '2026-07-20T10:10:00.000Z')
    );
    await firestore.collection('intex_agent_test_runs').doc('run_new').set(
      staged('run_new', '2026-07-20T10:11:00.000Z')
    );

    await expect(
      repository.listStagedArtifactsFinishedBefore({
        cutoff: '2026-07-20T10:10:00.000Z',
        limit: 20,
      })
    ).resolves.toMatchObject({
      ok: true,
      records: [{ runId: 'run_old' }, { runId: 'run_cutoff' }],
    });
    await expect(
      repository.listStagedArtifactsFinishedBefore({
        cutoff: '2026-07-20T10:10:00.000Z',
        limit: 19 as 20,
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('serializes an artifact-timeout claim across repository instances', async () => {
    const { firestore, repository } = fixture();
    const competingRepository = new FirestoreTestRunRepository({
      firestore,
      crypto: contextCrypto(),
    });
    const jsonCandidateDigest = '1'.repeat(64);
    const markdownCandidateDigest = '2'.repeat(64);
    const artifactStageDigest = digestArtifactCandidates(
      jsonCandidateDigest,
      markdownCandidateDigest
    );
    await firestore.collection('intex_agent_test_runs').doc('run_1').set(
      testRunRecord({
        revision: 5,
        lifecycle: 'completed',
        verdict: 'passed',
        finishedAt: later,
        artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
        artifactStageDigest,
        terminalWinner: {
          kind: 'release',
          eventId: 'terminal_event_1',
          payloadDigest: 'f'.repeat(64),
          outcome: 'completed_passed',
          acknowledgedAt: later,
        },
      })
    );
    await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').set({
      ...emptyRunManifest(),
      artifactStage: {
        revision: 2,
        jsonCandidateDigest,
        markdownCandidateDigest,
        compositeDigest: artifactStageDigest,
        stagedAt: later,
      },
    });
    const command = {
      expectedRevision: 5,
      updatedAt: '2026-07-20T10:20:00.000Z',
      next: {
        status: 'unknown' as const,
        failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT' as const,
      },
    };

    const results = await Promise.all([
      repository.applyArtifactDelivery({ identity: identity(), command }),
      competingRepository.applyArtifactDelivery({ identity: identity(), command }),
    ]);

    expect(results).toContainEqual(
      expect.objectContaining({ ok: true, disposition: 'applied' })
    );
    expect(results).toContainEqual(
      expect.objectContaining({ ok: true, disposition: 'already_applied' })
    );
    await expect(repository.getExact(identity())).resolves.toMatchObject({
      ok: true,
      record: {
        revision: 6,
        artifactDelivery: {
          status: 'unknown',
          failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT',
        },
      },
    });
  });

  it('fails closed across artifact-delivery roots and recognizes every terminal retry shape', async () => {
    const stageCommand = {
      expectedRevision: 1,
      updatedAt: later,
      next: {
        status: 'staged' as const,
        jsonCandidateDigest: '1'.repeat(64),
        markdownCandidateDigest: '2'.repeat(64),
      },
    };

    {
      const { repository } = fixture();
      await expect(
        repository.applyArtifactDelivery({
          identity: { ...identity(), runId: '' },
          command: stageCommand,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
      await expect(
        repository.applyArtifactDelivery({ identity: identity(), command: stageCommand })
      ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    }

    for (const corruptRoot of ['run', 'manifest'] as const) {
      const { firestore, repository } = fixture();
      await firestore.collection('intex_agent_test_runs').doc('run_1').set(
        corruptRoot === 'run'
          ? { corrupt: true }
          : testRunRecord({ lifecycle: 'running', revision: 1 })
      );
      await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').set(
        corruptRoot === 'manifest' ? { corrupt: true } : emptyRunManifest()
      );
      await expect(
        repository.applyArtifactDelivery({ identity: identity(), command: stageCommand })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECORD' });
    }

    for (const foreignRoot of ['run', 'manifest'] as const) {
      const { firestore, repository } = fixture();
      await firestore.collection('intex_agent_test_runs').doc('run_1').set(
        testRunRecord({
          lifecycle: 'running',
          revision: 1,
          ...(foreignRoot === 'run' ? { userId: 'auth0:foreign' } : {}),
        })
      );
      await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').set({
        ...emptyRunManifest(),
        ...(foreignRoot === 'manifest' ? { leaseFence: '8' } : {}),
      });
      await expect(
        repository.applyArtifactDelivery({ identity: identity(), command: stageCommand })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    }

    const terminalWinner = {
      kind: 'release' as const,
      eventId: 'terminal_event_1',
      payloadDigest: 'f'.repeat(64),
      outcome: 'completed_passed' as const,
      acknowledgedAt: later,
    };
    const retryCases = [
      {
        artifactDelivery: { status: 'ready' as const, failureCode: null, updatedAt: later },
        command: {
          expectedRevision: 5,
          updatedAt: later,
          next: { status: 'ready' as const, terminalControlEventId: 'terminal_event_1' },
        },
      },
      {
        artifactDelivery: {
          status: 'failed' as const,
          failureCode: 'REPORT_VALIDATION_FAILED' as const,
          updatedAt: later,
        },
        command: {
          expectedRevision: 5,
          updatedAt: later,
          next: { status: 'failed' as const, failureCode: 'REPORT_VALIDATION_FAILED' as const },
        },
      },
      {
        artifactDelivery: {
          status: 'failed' as const,
          failureCode: 'REPORT_PUBLICATION_FAILED' as const,
          updatedAt: later,
        },
        command: {
          expectedRevision: 5,
          updatedAt: later,
          next: {
            status: 'failed' as const,
            failureCode: 'REPORT_PUBLICATION_FAILED' as const,
            terminalControlEventId: 'terminal_event_1',
          },
        },
      },
    ];
    for (const retry of retryCases) {
      const { firestore, repository } = fixture();
      await firestore.collection('intex_agent_test_runs').doc('run_1').set(
        testRunRecord({
          revision: 6,
          lifecycle: 'completed',
          verdict: 'passed',
          updatedAt: later,
          finishedAt: later,
          artifactDelivery: retry.artifactDelivery,
          terminalWinner,
        })
      );
      await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').set(
        emptyRunManifest()
      );
      await expect(
        repository.applyArtifactDelivery({ identity: identity(), command: retry.command })
      ).resolves.toMatchObject({ ok: true, disposition: 'already_applied', record: { revision: 6 } });
    }
  });

  it('deletes one terminal target by exact manifest bindings and preserves ordinary sessions', async () => {
    const { firestore, repository } = fixture();
    await writeCleanupFixture(firestore);

    await expect(
      repository.cleanupExactRun({
        currentIdentity: { runId: 'run_current', userId: 'auth0:user_1', leaseFence: '8' },
        targetIdentity: { runId: 'run_target', userId: 'auth0:user_1', leaseFence: '7' },
        updatedAt: later,
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      removed: { runs: 1, sessions: 1, events: 1, scenarioProjections: 1 },
      currentRecord: { runId: 'run_current', retentionReconciled: true },
    });

    for (const [collection, id] of [
      ['intex_agent_test_runs', 'run_target'],
      ['intex_agent_matrix_corpus_run_manifests', 'run_target'],
      ['intex_agent_matrix_corpus_run_contexts', 'run_target'],
      ['intex_agent_sessions', 'matrix_target_session'],
      ['intex_agent_session_events', 'target_event_1'],
    ] as const) {
      await expect(firestore.collection(collection).doc(id).get()).resolves.toMatchObject({
        exists: false,
      });
    }
    await expect(
      firestore.collection('intex_agent_sessions').doc('ordinary_session').get()
    ).resolves.toMatchObject({ exists: true });

    await expect(
      repository.cleanupExactRun({
        currentIdentity: { runId: 'run_current', userId: 'auth0:user_1', leaseFence: '8' },
        targetIdentity: { runId: 'run_target', userId: 'auth0:user_1', leaseFence: '7' },
        updatedAt: later,
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'already_applied' });
  });

  it('refuses to clean the latest retained successful run before deleting child evidence', async () => {
    const { firestore, repository } = fixture();
    await writeCleanupFixture(firestore);
    await firestore.collection('intex_agent_test_runs').doc('run_newer_success').delete();

    await expect(
      repository.cleanupExactRun({
        currentIdentity: { runId: 'run_current', userId: 'auth0:user_1', leaseFence: '8' },
        targetIdentity: { runId: 'run_target', userId: 'auth0:user_1', leaseFence: '7' },
        updatedAt: later,
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    await expect(
      firestore.collection('intex_agent_session_events').doc('target_event_1').get()
    ).resolves.toMatchObject({ exists: true });
  });

  it('resumes exact cleanup after a prior child-deletion batch was interrupted', async () => {
    const { firestore, repository } = fixture();
    await writeCleanupFixture(firestore);
    await firestore.collection('intex_agent_session_events').doc('target_event_1').delete();

    await expect(
      repository.cleanupExactRun({
        currentIdentity: { runId: 'run_current', userId: 'auth0:user_1', leaseFence: '8' },
        targetIdentity: { runId: 'run_target', userId: 'auth0:user_1', leaseFence: '7' },
        updatedAt: later,
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'applied' });
    await expect(
      firestore.collection('intex_agent_test_runs').doc('run_target').get()
    ).resolves.toMatchObject({ exists: false });
  });

  it('stops exact cleanup on a session ownership mismatch without deleting target data', async () => {
    const { firestore, repository } = fixture();
    await writeCleanupFixture(firestore);
    const targetSession = await firestore
      .collection('intex_agent_sessions')
      .doc('matrix_target_session')
      .get();
    await firestore.collection('intex_agent_sessions').doc('matrix_target_session').set({
      ...targetSession.data(),
      matrixCorpusProfile: {
        ...(targetSession.data()?.['matrixCorpusProfile'] as Record<string, unknown>),
        runId: 'run_other',
      },
    });

    await expect(
      repository.cleanupExactRun({
        currentIdentity: { runId: 'run_current', userId: 'auth0:user_1', leaseFence: '8' },
        targetIdentity: { runId: 'run_target', userId: 'auth0:user_1', leaseFence: '7' },
        updatedAt: later,
      })
    ).resolves.toEqual({ ok: false, code: 'EVIDENCE_MISMATCH' });
    await expect(
      firestore.collection('intex_agent_test_runs').doc('run_target').get()
    ).resolves.toMatchObject({ exists: true });
    await expect(
      firestore.collection('intex_agent_sessions').doc('ordinary_session').get()
    ).resolves.toMatchObject({ exists: true });
  });

  it('stops cleanup when a manifest-bound session or projection is missing', async () => {
    const projectionId = createHash('sha256')
      .update('v1\u0000run_target\u0000scenario_001', 'utf8')
      .digest('hex');
    for (const missingRoot of ['session', 'projection'] as const) {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      if (missingRoot === 'session')
        await firestore
          .collection('intex_agent_sessions')
          .doc('matrix_target_session')
          .delete();
      if (missingRoot === 'projection')
        await firestore
          .collection('intex_agent_test_run_scenarios')
          .doc(`v1_${projectionId}`)
          .delete();

      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'EVIDENCE_MISMATCH',
      });
    }
  });

  it('fails closed when cleanup roots or child evidence change before the final transaction', async () => {
    const projectionId = createHash('sha256')
      .update('v1\u0000run_target\u0000scenario_001', 'utf8')
      .digest('hex');
    const races: Readonly<{
      name: string;
      mutate(firestore: Firestore): Promise<void>;
      code: 'EVIDENCE_MISMATCH' | 'INVALID_TRANSITION';
    }>[] = [
      {
        name: 'current run removed',
        mutate: async (firestore): Promise<void> => {
          await firestore.collection('intex_agent_test_runs').doc('run_current').delete();
        },
        code: 'EVIDENCE_MISMATCH',
      },
      {
        name: 'target run removed',
        mutate: async (firestore): Promise<void> => {
          await firestore.collection('intex_agent_test_runs').doc('run_target').delete();
        },
        code: 'EVIDENCE_MISMATCH',
      },
      {
        name: 'target context removed',
        mutate: async (firestore): Promise<void> => {
          await firestore
            .collection('intex_agent_matrix_corpus_run_contexts')
            .doc('run_target')
            .delete();
        },
        code: 'EVIDENCE_MISMATCH',
      },
      {
        name: 'target manifest removed',
        mutate: async (firestore): Promise<void> => {
          await firestore
            .collection('intex_agent_matrix_corpus_run_manifests')
            .doc('run_target')
            .delete();
        },
        code: 'EVIDENCE_MISMATCH',
      },
      {
        name: 'current run changed',
        mutate: async (firestore): Promise<void> => {
          await firestore
            .collection('intex_agent_test_runs')
            .doc('run_current')
            .update({ retentionReconciled: true });
        },
        code: 'EVIDENCE_MISMATCH',
      },
      {
        name: 'bound session removed',
        mutate: async (firestore): Promise<void> => {
          await firestore
            .collection('intex_agent_sessions')
            .doc('matrix_target_session')
            .delete();
        },
        code: 'EVIDENCE_MISMATCH',
      },
      {
        name: 'projection corrupted',
        mutate: async (firestore): Promise<void> => {
          await firestore
            .collection('intex_agent_test_run_scenarios')
            .doc(`v1_${projectionId}`)
            .set({ runId: 'run_target', corrupt: true });
        },
        code: 'EVIDENCE_MISMATCH',
      },
      {
        name: 'projection removed',
        mutate: async (firestore): Promise<void> => {
          await firestore
            .collection('intex_agent_test_run_scenarios')
            .doc(`v1_${projectionId}`)
            .delete();
        },
        code: 'EVIDENCE_MISMATCH',
      },
      {
        name: 'retention corrupted',
        mutate: async (firestore): Promise<void> => {
          await firestore.collection('intex_agent_test_runs').doc('race_corrupt').set({
            userId: 'auth0:user_1',
            runtimeAudience: 'hetzner-prod',
            startedAt: later,
          });
        },
        code: 'INVALID_TRANSITION',
      },
      {
        name: 'scenario context reappeared',
        mutate: async (firestore): Promise<void> => {
          await firestore
            .collection('intex_agent_matrix_corpus_scenario_contexts')
            .doc('race_context')
            .set({ ...activeScenarioContext(), runId: 'run_target', leaseFence: '7' });
        },
        code: 'EVIDENCE_MISMATCH',
      },
      {
        name: 'child event reappeared',
        mutate: async (firestore): Promise<void> => {
          await firestore.collection('intex_agent_session_events').doc('race_event').set({
            id: 'race_event',
            sessionId: 'matrix_target_session',
            userId: 'auth0:user_1',
            type: 'user_message',
            payload: { race: true },
            createdAt: later,
            eventSequence: 1,
          });
        },
        code: 'EVIDENCE_MISMATCH',
      },
    ];
    for (const race of races) {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      injectNextTransactionMutation(firestore, async () => race.mutate(firestore));
      await expect(repository.cleanupExactRun(cleanupInput()), race.name).resolves.toEqual({
        ok: false,
        code: race.code,
      });
    }
  });

  it('rejects a cleanup child whose stored owner or Matrix lane is not exact', async () => {
    const { firestore, repository } = fixture();
    await writeCleanupFixture(firestore);
    const confirmationRef = firestore
      .collection('intex_agent_matrix_corpus_test_confirmations')
      .doc('target_confirmation_1');
    const confirmation = await confirmationRef.get();
    await confirmationRef.set({
      ...confirmation.data(),
      userBindingDigest: 'f'.repeat(64),
    });

    await expect(
      repository.cleanupExactRun({
        currentIdentity: { runId: 'run_current', userId: 'auth0:user_1', leaseFence: '8' },
        targetIdentity: { runId: 'run_target', userId: 'auth0:user_1', leaseFence: '7' },
        updatedAt: later,
      })
    ).resolves.toEqual({ ok: false, code: 'EVIDENCE_MISMATCH' });
    await expect(confirmationRef.get()).resolves.toMatchObject({ exists: true });
  });

  it('removes a stale but exact target scenario context during resumed cleanup', async () => {
    const { firestore, repository } = fixture();
    await writeCleanupFixture(firestore);
    await firestore
      .collection('intex_agent_matrix_corpus_scenario_contexts')
      .doc('stale_target_context')
      .set({
        ...activeScenarioContext(),
        runId: 'run_target',
        leaseFence: '7',
      });

    await expect(repository.cleanupExactRun(cleanupInput())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      removed: { scenarioContexts: 1 },
    });
    await expect(
      firestore
        .collection('intex_agent_matrix_corpus_scenario_contexts')
        .doc('stale_target_context')
        .get()
    ).resolves.toMatchObject({ exists: false });
  });

  it('rejects cleanup when the finalized context no longer matches its bound tombstone digest', async () => {
    const { firestore, repository } = fixture();
    await writeCleanupFixture(firestore);
    const contextRef = firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_target');
    const context = await contextRef.get();
    await contextRef.set({
      ...context.data(),
      finalizedAt: '2026-07-20T10:06:00.000Z',
    });

    await expect(
      repository.cleanupExactRun({
        currentIdentity: { runId: 'run_current', userId: 'auth0:user_1', leaseFence: '8' },
        targetIdentity: { runId: 'run_target', userId: 'auth0:user_1', leaseFence: '7' },
        updatedAt: later,
      })
    ).resolves.toEqual({ ok: false, code: 'EVIDENCE_MISMATCH' });
    await expect(
      firestore.collection('intex_agent_session_events').doc('target_event_1').get()
    ).resolves.toMatchObject({ exists: true });
  });

  it('rejects cleanup when the manifest terminal candidate differs from the released run', async () => {
    const { firestore, repository } = fixture();
    await writeCleanupFixture(firestore);
    const manifestRef = firestore
      .collection('intex_agent_matrix_corpus_run_manifests')
      .doc('run_target');
    const manifest = await manifestRef.get();
    const storedCandidate = manifest.data()?.['terminalCandidate'] as Record<string, unknown>;
    await manifestRef.set({
      ...manifest.data(),
      terminalCandidate: { ...storedCandidate, projectionDigest: '0'.repeat(64) },
    });

    await expect(
      repository.cleanupExactRun({
        currentIdentity: { runId: 'run_current', userId: 'auth0:user_1', leaseFence: '8' },
        targetIdentity: { runId: 'run_target', userId: 'auth0:user_1', leaseFence: '7' },
        updatedAt: later,
      })
    ).resolves.toEqual({ ok: false, code: 'EVIDENCE_MISMATCH' });
    await expect(
      firestore.collection('intex_agent_session_events').doc('target_event_1').get()
    ).resolves.toMatchObject({ exists: true });
  });

  it('rejects each released-target artifact and winner evidence mismatch', async () => {
    const mutations: ((firestore: Firestore) => Promise<void>)[] = [
      async (firestore): Promise<void> => {
        const runRef = firestore.collection('intex_agent_test_runs').doc('run_target');
        const run = await runRef.get();
        const manifestRef = firestore
          .collection('intex_agent_matrix_corpus_run_manifests')
          .doc('run_target');
        const manifest = await manifestRef.get();
        await runRef.set({
          ...run.data(),
          terminalCandidate: null,
          artifactStageDigest: null,
        });
        await manifestRef.set({
          ...manifest.data(),
          terminalCandidate: null,
          artifactStage: null,
        });
      },
      async (firestore): Promise<void> => {
        const runRef = firestore.collection('intex_agent_test_runs').doc('run_target');
        const run = await runRef.get();
        await runRef.set({ ...run.data(), artifactStageDigest: '0'.repeat(64) });
      },
      async (firestore): Promise<void> => {
        const runRef = firestore.collection('intex_agent_test_runs').doc('run_target');
        const run = await runRef.get();
        const winner = run.data()?.['terminalWinner'] as Record<string, unknown>;
        await runRef.set({
          ...run.data(),
          terminalWinner: { ...winner, outcome: 'completed_failed' },
        });
      },
    ];
    for (const mutate of mutations) {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await mutate(firestore);
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'EVIDENCE_MISMATCH',
      });
    }
  });

  it('cleans an abandoned terminal target only with its exact recovery receipt', async () => {
    const { firestore, repository } = fixture();
    await writeCleanupFixture(firestore);
    const runRef = firestore.collection('intex_agent_test_runs').doc('run_target');
    const run = await runRef.get();
    const manifestRef = firestore
      .collection('intex_agent_matrix_corpus_run_manifests')
      .doc('run_target');
    const manifest = await manifestRef.get();
    await runRef.set({
      ...run.data(),
      lifecycle: 'stopped',
      verdict: 'not_evaluated',
      terminalCandidate: null,
      artifactStageDigest: null,
      terminalWinner: {
        kind: 'abandoned',
        eventId: 'abandoned_target_event',
        payloadDigest: 'e'.repeat(64),
        outcome: 'stopped_not_evaluated',
        acknowledgedAt: later,
      },
    });
    await manifestRef.set({
      ...manifest.data(),
      terminalCandidate: null,
      artifactStage: null,
    });
    await firestore
      .collection('intex_agent_matrix_corpus_recovery_receipts')
      .doc('run_target')
      .set({
        version: 1,
        runtimeAudience: 'hetzner-prod',
        runId: 'run_target',
        userId: 'auth0:user_1',
        leaseFence: '7',
        eventId: 'abandoned_target_event',
        payloadDigest: 'e'.repeat(64),
        outcome: 'stopped_not_evaluated',
        acknowledgedAt: later,
      });

    await expect(repository.cleanupExactRun(cleanupInput())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      removed: { runs: 1 },
    });
    await expect(
      firestore
        .collection('intex_agent_matrix_corpus_recovery_receipts')
        .doc('run_target')
        .get()
    ).resolves.toMatchObject({ exists: false });
  });

  it('fails closed for every missing, corrupt, or foreign current cleanup root', async () => {
    const currentRoots = [
      ['intex_agent_test_runs', 'run_current'],
      ['intex_agent_matrix_corpus_run_contexts', 'run_current'],
      ['intex_agent_matrix_corpus_run_manifests', 'run_current'],
    ] as const;
    for (const [collection, id] of currentRoots) {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await firestore.collection(collection).doc(id).delete();
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
    }
    for (const [collection, id] of currentRoots) {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await firestore.collection(collection).doc(id).set({ corrupt: true });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_RECORD',
      });
    }
    for (const [collection, id] of currentRoots) {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      const ref = firestore.collection(collection).doc(id);
      const snapshot = await ref.get();
      await ref.set({ ...snapshot.data(), userId: 'auth0:foreign' });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
    }
  });

  it('rejects invalid current state and corrupt retention before inspecting cleanup targets', async () => {
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await firestore.collection('intex_agent_test_runs').doc('run_current').set(
        testRunRecord({ runId: 'run_current', leaseFence: '8', lifecycle: 'running' })
      );
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'INVALID_TRANSITION',
      });
    }
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      const manifestRef = firestore
        .collection('intex_agent_matrix_corpus_run_manifests')
        .doc('run_current');
      const manifest = await manifestRef.get();
      await manifestRef.set({
        ...manifest.data(),
        scenarioBindings: [
          {
            scenarioId: 'scenario_001',
            scenarioNumber: 1,
            scenarioLabel: 'Scenario 001/020',
            sessionId: 'unexpected_session',
          },
        ],
      });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'INVALID_TRANSITION',
      });
    }
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await firestore.collection('intex_agent_test_runs').doc('run_corrupt_retention').set({
        userId: 'auth0:user_1',
        runtimeAudience: 'hetzner-prod',
        startedAt: '2026-07-20T10:03:00.000Z',
      });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_RECORD',
      });
    }
  });

  it('distinguishes absent, partial, corrupt, and foreign target cleanup roots', async () => {
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await Promise.all([
        firestore.collection('intex_agent_test_runs').doc('run_target').delete(),
        firestore
          .collection('intex_agent_matrix_corpus_run_contexts')
          .doc('run_target')
          .delete(),
        firestore
          .collection('intex_agent_matrix_corpus_run_manifests')
          .doc('run_target')
          .delete(),
      ]);
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'EVIDENCE_MISMATCH',
      });
    }
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await firestore
        .collection('intex_agent_matrix_corpus_run_contexts')
        .doc('run_target')
        .delete();
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'EVIDENCE_MISMATCH',
      });
    }

    const targetRoots = [
      ['intex_agent_test_runs', 'run_target'],
      ['intex_agent_matrix_corpus_run_contexts', 'run_target'],
      ['intex_agent_matrix_corpus_run_manifests', 'run_target'],
    ] as const;
    for (const [collection, id] of targetRoots) {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await firestore.collection(collection).doc(id).set({ corrupt: true });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_RECORD',
      });
    }
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await firestore
        .collection('intex_agent_matrix_corpus_recovery_receipts')
        .doc('run_target')
        .set({ corrupt: true });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_RECORD',
      });
    }
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await firestore
        .collection('intex_agent_matrix_corpus_scenario_contexts')
        .doc('target_context_corrupt')
        .set({ runId: 'run_target', corrupt: true });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_RECORD',
      });
    }
    for (const [collection, id] of targetRoots) {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      const ref = firestore.collection(collection).doc(id);
      const snapshot = await ref.get();
      const data = snapshot.data() as Record<string, unknown>;
      await ref.set({
        ...data,
        runId: 'run_foreign',
        ...(collection !== 'intex_agent_matrix_corpus_run_contexts'
          ? {
              terminalCandidate: {
                ...(data['terminalCandidate'] as Record<string, unknown>),
                runId: 'run_foreign',
              },
            }
          : {}),
      });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
    }
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await firestore
        .collection('intex_agent_matrix_corpus_recovery_receipts')
        .doc('run_target')
        .set({
          version: 1,
          runtimeAudience: 'hetzner-prod',
          runId: 'run_target',
          userId: 'auth0:foreign',
          leaseFence: '7',
          eventId: 'abandoned_target',
          payloadDigest: 'f'.repeat(64),
          outcome: 'provisioning_noop',
          acknowledgedAt: later,
        });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
    }
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await firestore
        .collection('intex_agent_matrix_corpus_scenario_contexts')
        .doc('target_context_foreign')
        .set({
          ...activeScenarioContext(),
          runId: 'run_target',
          userId: 'auth0:foreign',
        });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
    }
  });

  it('rejects nonterminal targets and manifest-to-summary binding drift', async () => {
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      const contextRef = firestore
        .collection('intex_agent_matrix_corpus_run_contexts')
        .doc('run_target');
      await contextRef.set({ ...activeRunContext(), runId: 'run_target' });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'INVALID_TRANSITION',
      });
    }
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      const runRef = firestore.collection('intex_agent_test_runs').doc('run_target');
      const run = await runRef.get();
      await runRef.set({
        ...run.data(),
        artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
      });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'INVALID_TRANSITION',
      });
    }
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      const manifestRef = firestore
        .collection('intex_agent_matrix_corpus_run_manifests')
        .doc('run_target');
      const manifest = await manifestRef.get();
      const bindings = manifest.data()?.['scenarioBindings'] as Record<string, unknown>[];
      await manifestRef.set({
        ...manifest.data(),
        scenarioBindings: [{ ...bindings[0], sessionId: 'different_session' }],
      });
      await expect(repository.cleanupExactRun(cleanupInput())).resolves.toEqual({
        ok: false,
        code: 'EVIDENCE_MISMATCH',
      });
    }
  });

  it('creates one exact preflight projection and rejects changed correlated replay', async () => {
    const { repository } = fixture();

    await expect(repository.createOrGet(testRunRecord())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      record: { lifecycle: 'preflight', revision: 0 },
    });
    await expect(repository.createOrGet(testRunRecord())).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
    });
    await expect(
      repository.createOrGet(testRunRecord({ catalogDigest: 'b'.repeat(64) }))
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    await expect(repository.getExact(identity())).resolves.toMatchObject({
      ok: true,
      record: { runId: 'run_1', leaseFence: '7' },
    });
    await expect(
      repository.getExact({ ...identity(), leaseFence: '8' })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
  });

  it('fails closed for missing, foreign, and corrupt owner and projection mutations', async () => {
    const projectionCommand = {
      expectedRevision: 0,
      nextLifecycle: 'running' as const,
      updatedAt: later,
      scenario: null,
      finalization: null,
    };

    {
      const { repository } = fixture();
      await expect(repository.getExact(identity())).resolves.toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
      await expect(
        repository.applyProjection({ identity: identity(), command: projectionCommand })
      ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    }

    {
      const { firestore, repository } = fixture();
      await firestore.collection('intex_agent_test_runs').doc('run_1').set({ corrupt: true });
      await expect(
        repository.applyProjection({ identity: identity(), command: projectionCommand })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECORD' });
    }

    {
      const { firestore, repository } = fixture();
      await firestore.collection('intex_agent_test_runs').doc('run_1').set(
        testRunRecord({ userId: 'auth0:foreign' })
      );
      await expect(repository.getOwned('run_1', 'auth0:user_1')).resolves.toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
      await expect(
        repository.applyProjection({ identity: identity(), command: projectionCommand })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
      await expect(repository.getOwned('run_1', 'auth0:foreign')).resolves.toMatchObject({
        ok: true,
        record: { userId: 'auth0:foreign' },
      });
    }

    {
      const { repository } = fixture();
      await expect(
        repository.applyProjection({
          identity: { ...identity(), leaseFence: '0' },
          command: projectionCommand,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
      await repository.createOrGet(testRunRecord());
      await expect(
        repository.applyProjection({
          identity: identity(),
          command: { ...projectionCommand, expectedRevision: 1 },
        })
      ).resolves.toEqual({ ok: false, code: 'REVISION_CONFLICT' });
    }
  });

  it('serializes revision CAS and returns an exact retry without another write', async () => {
    const { repository } = fixture();
    await repository.createOrGet(testRunRecord());
    const command = {
      expectedRevision: 0,
      nextLifecycle: 'running' as const,
      updatedAt: later,
      scenario: null,
      finalization: null,
    };

    const results = await Promise.all([
      repository.applyProjection({ identity: identity(), command }),
      repository.applyProjection({ identity: identity(), command }),
    ]);
    expect(results).toContainEqual(
      expect.objectContaining({ ok: true, record: expect.objectContaining({ revision: 1 }) })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        ok: true,
        disposition: 'already_applied',
        record: expect.objectContaining({ revision: 1 }),
      })
    );
  });

  it('attests retention only after the bounded exact-ID plan has no eviction left', async () => {
    const command = {
      expectedRevision: 0,
      nextLifecycle: 'preflight' as const,
      updatedAt: later,
      retentionReconciled: true as const,
      scenario: null,
      finalization: null,
    };
    {
      const { repository } = fixture();
      await repository.createOrGet(testRunRecord({ retentionReconciled: false }));
      await expect(
        repository.applyProjection({ identity: identity(), command })
      ).resolves.toMatchObject({
        ok: true,
        disposition: 'applied',
        record: { revision: 1, retentionReconciled: true },
      });
      await expect(
        repository.applyProjection({ identity: identity(), command })
      ).resolves.toMatchObject({
        ok: true,
        disposition: 'already_applied',
        record: { revision: 1, retentionReconciled: true },
      });
    }
    {
      const { firestore, repository } = fixture();
      await writeCleanupFixture(firestore);
      await expect(
        repository.applyProjection({
          identity: {
            runId: 'run_current',
            userId: 'auth0:user_1',
            leaseFence: '8',
          },
          command,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    }
  });

  it('rejects corrupt retention evidence and stale reconciliation retries', async () => {
    {
      const { firestore, repository } = fixture();
      await repository.createOrGet(testRunRecord({ retentionReconciled: false }));
      await firestore.collection('intex_agent_test_runs').doc('corrupt_retention').set({
        userId: 'auth0:user_1',
        runtimeAudience: 'hetzner-prod',
        startedAt: later,
      });
      await expect(
        repository.applyProjection({
          identity: identity(),
          command: {
            expectedRevision: 0,
            nextLifecycle: 'preflight',
            updatedAt: later,
            retentionReconciled: true,
            scenario: null,
            finalization: null,
          },
        })
      ).resolves.toEqual({ ok: false, code: 'EVIDENCE_MISMATCH' });
    }
    {
      const { repository } = fixture();
      await repository.createOrGet(testRunRecord({ retentionReconciled: true }));
      await expect(
        repository.applyProjection({
          identity: identity(),
          command: {
            expectedRevision: 5,
            nextLifecycle: 'preflight',
            updatedAt: later,
            retentionReconciled: true,
            scenario: null,
            finalization: null,
          },
        })
      ).resolves.toEqual({ ok: false, code: 'REVISION_CONFLICT' });
    }
  });

  it('rejects scenario projection without the exact manifest-bound session evidence', async () => {
    const { firestore, repository } = fixture();
    await createRunningScenarioRun(repository);
    await writeScenarioEvidence(firestore, { manifestSessionId: 'different_session' });

    await expect(
      repository.applyProjection({
        identity: identity(),
        command: scenarioProjectionCommand(),
      })
    ).resolves.toEqual({ ok: false, code: 'EVIDENCE_MISMATCH' });
  });

  it('rejects an oversized scenario projection before reading Firestore evidence', async () => {
    const { repository } = fixture();
    const base = scenarioProjectionCommand();

    await expect(
      repository.applyProjection({
        identity: identity(),
        command: {
          ...base,
          scenario: {
            ...base.scenario,
            projection: {
              ...base.scenario.projection,
              oversized: 'x'.repeat(140_000),
            } as never,
          },
        },
      })
    ).resolves.toEqual({ ok: false, code: 'DOCUMENT_TOO_LARGE' });
  });

  it('rejects scenario projection when its manifest or bound session is absent', async () => {
    for (const missingRoot of ['manifest', 'session'] as const) {
      const { firestore, repository } = fixture();
      await createRunningScenarioRun(repository);
      await writeScenarioEvidence(firestore);
      if (missingRoot === 'manifest')
        await firestore
          .collection('intex_agent_matrix_corpus_run_manifests')
          .doc('run_1')
          .delete();
      if (missingRoot === 'session')
        await firestore.collection('intex_agent_sessions').doc('matrix_session_1').delete();

      await expect(
        repository.applyProjection({
          identity: identity(),
          command: scenarioProjectionCommand(),
        })
      ).resolves.toEqual({ ok: false, code: 'EVIDENCE_MISMATCH' });
    }
  });

  it('rejects a nonzero scenario revision when no projection document exists', async () => {
    const { firestore, repository } = fixture();
    await createRunningScenarioRun(repository);
    await writeScenarioEvidence(firestore);
    const base = scenarioProjectionCommand();

    await expect(
      repository.applyProjection({
        identity: identity(),
        command: {
          ...base,
          scenario: { ...base.scenario, expectedScenarioRevision: 1 },
        },
      })
    ).resolves.toEqual({ ok: false, code: 'EVIDENCE_MISMATCH' });
  });

  it('commits a scenario watermark only when the exact event range is contiguous', async () => {
    const { firestore, repository } = fixture();
    await createRunningScenarioRun(repository);
    await writeScenarioEvidence(firestore);

    const applied = await repository.applyProjection({
        identity: identity(),
        command: scenarioProjectionCommand(),
      });
    expect(applied).toMatchObject({ ok: true, disposition: 'applied' });
    if (!applied.ok) throw new Error('fixture projection failed');
    expect(applied.record.scenarios[0]).toMatchObject({
      scenarioId: 'scenario_001',
      sessionId: 'matrix_session_1',
      eventWatermark: 1,
      scenarioRevision: 1,
    });
    await expect(
      repository.applyProjection({
        identity: identity(),
        command: scenarioProjectionCommand(),
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
      record: { revision: 2 },
    });
    const changedReplay = scenarioProjectionCommand();
    await expect(
      repository.applyProjection({
        identity: identity(),
        command: {
          ...changedReplay,
          scenario: {
            ...changedReplay.scenario,
            projection: {
              ...changedReplay.scenario.projection,
              runRevision: 3,
            },
          },
        },
      })
    ).resolves.toEqual({ ok: false, code: 'SCENARIO_REVISION_CONFLICT' });
    const scenarioDocuments = await firestore
      .collection('intex_agent_test_run_scenarios')
      .where('runId', '==', 'run_1')
      .get();
    expect(scenarioDocuments.docs).toHaveLength(1);
    await expect(
      repository.getScenarioConsistent({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
      })
    ).resolves.toMatchObject({
      ok: true,
      run: { revision: 2 },
      projection: { scenarioRevision: 1, eventWatermark: 1 },
      events: [{ eventSequence: 1 }],
    });
    await expect(
      repository.getScenarioConsistent({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:foreign',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    await firestore.collection('intex_agent_session_events').doc('matrix_event_1').delete();
    await expect(
      repository.getScenarioConsistent({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
      })
    ).resolves.toEqual({ ok: false, code: 'STALE_PROJECTION' });
    await expect(
      repository.applyProjection({
        identity: identity(),
        command: {
          ...scenarioProjectionCommand(),
          expectedRevision: 2,
          scenario: {
            ...scenarioProjectionCommand().scenario,
            expectedScenarioRevision: 1,
          },
        },
      })
    ).resolves.toEqual({ ok: false, code: 'EVENT_WATERMARK_GAP' });
  });

  it('rejects unbound and identity-drifted scenario reads before returning evidence', async () => {
    {
      const { repository } = fixture();
      await repository.createOrGet(testRunRecord());
      await expect(
        repository.getScenarioConsistent({
          runId: 'run_1',
          scenarioId: 'scenario_001',
          userId: 'auth0:user_1',
        })
      ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    }
    {
      const { firestore, repository } = fixture();
      await createRunningScenarioRun(repository);
      await writeScenarioEvidence(firestore);
      const applied = await repository.applyProjection({
        identity: identity(),
        command: scenarioProjectionCommand(),
      });
      if (!applied.ok) throw new Error('projection fixture failed');
      await firestore
        .collection('intex_agent_sessions')
        .doc('matrix_session_1')
        .update({ userId: 'auth0:foreign' });
      await expect(
        repository.getScenarioConsistent({
          runId: 'run_1',
          scenarioId: 'scenario_001',
          userId: 'auth0:user_1',
        })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECORD' });
    }
  });

  it('sorts and validates a multi-event range before committing a scenario projection', async () => {
    const { firestore, repository } = fixture();
    await createRunningScenarioRun(repository);
    await writeScenarioEvidence(firestore);
    await firestore
      .collection('intex_agent_sessions')
      .doc('matrix_session_1')
      .update({ lastEventSequence: 2 });
    const firstEvent = await firestore
      .collection('intex_agent_session_events')
      .doc('matrix_event_1')
      .get();
    await firestore.collection('intex_agent_session_events').doc('matrix_event_2').set({
      ...firstEvent.data(),
      id: 'matrix_event_2',
      eventSequence: 2,
    });
    const base = scenarioProjectionCommand();
    const command = {
      ...base,
      scenario: {
        ...base.scenario,
        eventWatermark: 2,
        projection: { ...base.scenario.projection, eventWatermark: 2 },
      },
    };

    const result = await repository.applyProjection({ identity: identity(), command });
    expect(result).toMatchObject({ ok: true, disposition: 'applied' });
    if (!result.ok) throw new Error('multi-event projection failed');
    expect(result.record.scenarios[0]?.eventWatermark).toBe(2);
  });

  it('rejects foreign events and corrupt sibling projections during scenario CAS', async () => {
    {
      const { firestore, repository } = fixture();
      await createRunningScenarioRun(repository);
      await writeScenarioEvidence(firestore);
      await firestore
        .collection('intex_agent_session_events')
        .doc('matrix_event_1')
        .update({ userId: 'auth0:foreign' });
      await expect(
        repository.applyProjection({
          identity: identity(),
          command: scenarioProjectionCommand(),
        })
      ).resolves.toEqual({ ok: false, code: 'EVENT_WATERMARK_GAP' });
    }
    {
      const { firestore, repository } = fixture();
      await createRunningScenarioRun(repository);
      await writeScenarioEvidence(firestore);
      await firestore
        .collection('intex_agent_test_run_scenarios')
        .doc('corrupt_sibling')
        .set({ runId: 'run_1', corrupt: true });
      await expect(
        repository.applyProjection({
          identity: identity(),
          command: scenarioProjectionCommand(),
        })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECORD' });
    }
  });

  it('rejects scenario summary and evidence projections that derive different totals', async () => {
    const { firestore, repository } = fixture();
    await repository.createOrGet(
      testRunRecord({
        scenarios: Array.from({ length: 20 }, (_, index) =>
          index === 1
            ? testRunScenario(2, {
                sessionId: 'matrix_session_2',
                sessionBindingDigest: '8'.repeat(64),
              })
            : testRunScenario(index + 1)
        ),
      })
    );
    await repository.applyProjection({
      identity: identity(),
      command: {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: null,
        finalization: null,
      },
    });
    await writeScenarioEvidence(firestore);
    const siblingProjectionId = createHash('sha256')
      .update('v1\u0000run_1\u0000scenario_002', 'utf8')
      .digest('hex');
    await firestore
      .collection('intex_agent_test_run_scenarios')
      .doc(`v1_${siblingProjectionId}`)
      .set({
        schemaVersion: 1,
        runId: 'run_1',
        userId: 'auth0:user_1',
        sessionId: 'matrix_session_2',
        sessionBindingDigest: '8'.repeat(64),
        scenarioId: 'scenario_002',
        scenarioNumber: 2,
        scenarioLabel: 'Scenario 002/020',
        runRevision: 1,
        scenarioRevision: 0,
        eventWatermark: 0,
        lifecycle: 'not_run',
        verdict: 'pending',
        plannedTurns: 2,
        completedTurns: 0,
        toolEvidence: [],
        deterministicChecks: [],
        replyEvaluations: [],
        agentUsage: [],
      });

    await expect(
      repository.applyProjection({
        identity: identity(),
        command: scenarioProjectionCommand(),
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('derives run evidence totals and exact nano-USD cost from scenario projections', async () => {
    const { firestore, repository } = fixture();
    await createRunningScenarioRun(repository);
    await writeScenarioEvidence(firestore);
    const base = scenarioProjectionCommand();
    const command = {
      ...base,
      scenario: {
        ...base.scenario,
        summary: {
          ...base.scenario.summary,
          completedTurns: 1,
          completedReplies: 1,
          selectedTools: ['create_note' as const],
          deterministicVerdict: 'passed' as const,
          semanticVerdict: 'passed' as const,
        },
        projection: {
          ...base.scenario.projection,
          completedTurns: 1,
          toolEvidence: [
            {
              event: 'selected' as const,
              toolName: 'create_note' as const,
              turnIndex: 0,
              ordinal: 1,
              facts: [],
            },
          ],
          deterministicChecks: [
            {
              code: 'tool_name' as const,
              status: 'passed' as const,
              turnIndex: 0,
              replyIndex: null,
              evidence: emptyDeterministicEvidence(),
            },
          ],
          replyEvaluations: [
            {
              turnIndex: 0,
              replyIndex: 1,
              verdict: 'passed' as const,
              score: 5 as const,
              criteria: {
                understoodIntent: true,
                helpful: true,
                conciseAndClear: true,
                professionalTone: true,
                noPassiveAggression: true,
              },
              failureCodes: [],
              latencyMs: 1,
              usage: {
                logicalCalls: 1 as const,
                repairCount: 0 as const,
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                costNanoUsd: 7,
              },
            },
          ],
          agentUsage: [
            {
              turnIndex: 0,
              stage: 'agent_generation' as const,
              callOrdinal: 1,
              inputTokens: 2,
              outputTokens: 1,
              totalTokens: 3,
              costNanoUsd: 11,
            },
          ],
        },
      },
    };

    await expect(repository.applyProjection({ identity: identity(), command })).resolves.toMatchObject({
      ok: true,
      record: {
        totals: {
          replies: { judged: 1 },
          tools: { selected: 1, mockCompleted: 0, mockFailed: 0, unexpectedKnown: 0 },
          evaluations: {
            deterministicPassed: 1,
            deterministicFailed: 0,
            minimaxPassed: 1,
            minimaxFailed: 0,
            pending: 19,
          },
        },
        cost: { agentNanoUsd: 11, evaluatorNanoUsd: 7, totalNanoUsd: 18 },
      },
    });
  });

  it('fails closed on invalid, missing, and corrupt scenario-read roots', async () => {
    const { firestore, repository } = fixture();
    for (const input of [
      { runId: '', scenarioId: 'scenario_001', userId: 'auth0:user_1' },
      { runId: 'run_1', scenarioId: '', userId: 'auth0:user_1' },
      { runId: 'run_1', scenarioId: 'scenario_001', userId: '' },
    ])
      await expect(repository.getScenarioConsistent(input)).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
    await expect(
      repository.getScenarioConsistent({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await firestore.collection('intex_agent_test_runs').doc('run_1').set({ corrupt: true });
    await expect(
      repository.getScenarioConsistent({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
      })
    ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECORD' });

    const command = scenarioProjectionCommand();
    const scenarios = Array.from({ length: 20 }, (_, index) =>
      index === 0
        ? testRunScenario(1, {
            ...command.scenario.summary,
            eventWatermark: 1,
            sessionId: 'matrix_session_1',
            sessionBindingDigest: '9'.repeat(64),
          })
        : testRunScenario(index + 1)
    );
    await firestore.collection('intex_agent_test_runs').doc('run_1').set(
      testRunRecord({ lifecycle: 'running', revision: 2, scenarios })
    );
    await expect(
      repository.getScenarioConsistent({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });

    const projectionId = createHash('sha256')
      .update('v1\u0000run_1\u0000scenario_001', 'utf8')
      .digest('hex');
    const projectionRef = firestore
      .collection('intex_agent_test_run_scenarios')
      .doc(`v1_${projectionId}`);
    await projectionRef.set({ corrupt: true });
    await firestore.collection('intex_agent_sessions').doc('matrix_session_1').set({
      corrupt: true,
    });
    await expect(
      repository.getScenarioConsistent({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
      })
    ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECORD' });

    await projectionRef.set(command.scenario.projection);
    await expect(
      repository.getScenarioConsistent({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
      })
    ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECORD' });
  });

  it('authorizes the exact bound Matrix session before querying scenario events', async () => {
    const { firestore, repository } = fixture();
    await createRunningScenarioRun(repository);
    await writeScenarioEvidence(firestore);
    const applied = await repository.applyProjection({
      identity: identity(),
      command: scenarioProjectionCommand(),
    });
    expect(applied).toMatchObject({ ok: true });

    const sessionRef = firestore.collection('intex_agent_sessions').doc('matrix_session_1');
    const session = await sessionRef.get();
    const data = session.data() as Record<string, unknown>;
    await sessionRef.set({
      ...data,
      matrixCorpusProfile: {
        ...(data['matrixCorpusProfile'] as Record<string, unknown>),
        runtimeAudience: 'production',
      },
    });
    const collectionSpy = vi.spyOn(firestore, 'collection');

    await expect(
      repository.getScenarioConsistent({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
      })
    ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECORD' });
    expect(
      collectionSpy.mock.calls.filter(([name]) => name === 'intex_agent_session_events')
    ).toHaveLength(0);
  });

  it('atomically finalizes context manifest and running projection in one transaction', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').set(
      activeRunContext()
    );
    await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').set(
      emptyRunManifest()
    );
    await repository.createOrGet(testRunRecord());
    await repository.applyProjection({
      identity: identity(),
      command: {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: null,
        finalization: null,
      },
    });
    const staged = await stageArtifacts(repository, 1);
    const artifactStageDigest = staged.digest;
    const stagedManifest = await firestore
      .collection('intex_agent_matrix_corpus_run_manifests')
      .doc('run_1')
      .get();
    expect(stagedManifest.data()).toMatchObject({
      artifactStage: {
        revision: 2,
        jsonCandidateDigest: '1'.repeat(64),
        markdownCandidateDigest: '2'.repeat(64),
        compositeDigest: artifactStageDigest,
      },
    });
    await expect(
      repository.applyArtifactDelivery({
        identity: identity(),
        command: {
          expectedRevision: 1,
          updatedAt: later,
          next: {
            status: 'staged',
            jsonCandidateDigest: '1'.repeat(64),
            markdownCandidateDigest: '2'.repeat(64),
          },
        },
      })
    ).resolves.toMatchObject({ ok: true, disposition: 'already_applied', record: { revision: 2 } });
    const candidate = terminalCandidate({
      artifactStageRevision: staged.record.revision,
      artifactCandidateDigest: staged.digest,
      projectionDigest: FirestoreTestRunRepository.digestProjection(staged.record, []),
    });

    await expect(
      repository.finalizeRun({
        identity: identity(),
        expectedRevision: 2,
        updatedAt: later,
        artifactStageDigest,
        terminalCandidate: { ...candidate, projectionDigest: '0'.repeat(64) },
      })
    ).resolves.toEqual({ ok: false, code: 'FINALIZATION_MISMATCH' });

    const finalized = await repository.finalizeRun({
      identity: identity(),
      expectedRevision: 2,
      updatedAt: later,
      artifactStageDigest,
      terminalCandidate: candidate,
    });

    expect(finalized).toMatchObject({
      ok: true,
      disposition: 'applied',
      record: { lifecycle: 'finalizing', revision: 3, terminalCandidate: candidate },
      tombstoneDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      scenarioContextCount: 0,
      finalizedAt: later,
    });
    await expect(
      firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').get()
    ).resolves.toMatchObject({
      exists: true,
    });
    const storedContext = await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .get();
    expect(storedContext.data()).toMatchObject({ status: 'finalized', finalizedAt: later });
    const storedManifest = await firestore
      .collection('intex_agent_matrix_corpus_run_manifests')
      .doc('run_1')
      .get();
    expect(storedManifest.data()).toMatchObject({ terminalCandidate: candidate });

    await expect(
      repository.finalizeRun({
        identity: identity(),
        expectedRevision: 2,
        updatedAt: later,
        artifactStageDigest,
        terminalCandidate: candidate,
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
      record: { lifecycle: 'finalizing', revision: 3 },
      tombstoneDigest: finalized.ok ? finalized.tombstoneDigest : undefined,
    });
  });

  it('rejects a changed finalization replay after the context tombstone was committed', async () => {
    const prepared = await prepareEmptyFinalizationFixture();
    const finalized = await prepared.repository.finalizeRun(prepared.input);
    if (!finalized.ok) throw new Error('finalization fixture failed');
    const contextRef = prepared.firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1');
    const context = await contextRef.get();
    await contextRef.set({
      ...context.data(),
      finalizedAt: '2026-07-20T10:06:00.000Z',
    });

    await expect(prepared.repository.finalizeRun(prepared.input)).resolves.toEqual({
      ok: false,
      code: 'FINALIZATION_MISMATCH',
    });
  });

  it('returns the state-machine finalization failure for an incompatible terminal outcome', async () => {
    const prepared = await prepareEmptyFinalizationFixture();
    const candidate = {
      ...prepared.input.terminalCandidate,
      outcome: 'completed_passed' as const,
    };

    await expect(
      prepared.repository.finalizeRun({
        ...prepared.input,
        terminalCandidate: candidate,
      })
    ).resolves.toEqual({ ok: false, code: 'FINALIZATION_MISMATCH' });
  });

  it('rejects finalizing through generic projection CAS', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').set(
      activeRunContext()
    );
    await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').set(
      emptyRunManifest()
    );
    await repository.createOrGet(testRunRecord());
    await repository.applyProjection({
      identity: identity(),
      command: {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: null,
        finalization: null,
      },
    });

    await expect(
      repository.applyProjection({
        identity: identity(),
        command: {
          expectedRevision: 1,
          nextLifecycle: 'finalizing',
          updatedAt: later,
          scenario: null,
          finalization: {
            tombstoneDigest: 'd'.repeat(64),
            artifactStageDigest: 'e'.repeat(64),
            terminalCandidate: terminalCandidate(),
          },
        },
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    const storedContext = await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .get();
    expect(storedContext.data()).toEqual(activeRunContext());
  });

  it('leaves active ciphertext untouched when atomic finalization CAS conflicts', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').set(
      activeRunContext()
    );
    await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').set(
      emptyRunManifest()
    );
    await repository.createOrGet(testRunRecord());
    await repository.applyProjection({
      identity: identity(),
      command: {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: null,
        finalization: null,
      },
    });

    await expect(
      repository.finalizeRun({
        identity: identity(),
        expectedRevision: 0,
        updatedAt: later,
        artifactStageDigest: 'e'.repeat(64),
        terminalCandidate: terminalCandidate(),
      })
    ).resolves.toEqual({ ok: false, code: 'REVISION_CONFLICT' });
    const storedContext = await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .get();
    expect(storedContext.data()).toEqual(activeRunContext());
  });

  it('refuses finalization until every bound session event is projected', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').set(
      activeRunContext()
    );
    await writeScenarioEvidence(firestore);
    await firestore.collection('intex_agent_matrix_corpus_scenario_contexts').doc('context_1').set(
      activeScenarioContext()
    );
    await repository.createOrGet(
      testRunRecord({
        scenarios: Array.from({ length: 20 }, (_, index) =>
          index === 0
            ? testRunScenario(1, {
            lifecycle: 'running',
            sessionId: 'matrix_session_1',
            sessionBindingDigest: '9'.repeat(64),
          })
            : testRunScenario(index + 1)
        ),
      })
    );
    await repository.applyProjection({
      identity: identity(),
      command: {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: null,
        finalization: null,
      },
    });

    const staged = await stageArtifacts(repository, 1);
    const input = {
      identity: identity(),
      expectedRevision: staged.record.revision,
      updatedAt: later,
      artifactStageDigest: staged.digest,
      terminalCandidate: terminalCandidate({
        artifactStageRevision: staged.record.revision,
        artifactCandidateDigest: staged.digest,
        projectionDigest: FirestoreTestRunRepository.digestProjection(staged.record, []),
      }),
    };
    const scenarioContextRef = firestore
      .collection('intex_agent_matrix_corpus_scenario_contexts')
      .doc('context_1');
    await scenarioContextRef.set({
      ...activeScenarioContext(),
      scenarioId: 'scenario_002',
    });
    await expect(repository.finalizeRun(input)).resolves.toEqual({
      ok: false,
      code: 'FINALIZATION_MISMATCH',
    });
    await scenarioContextRef.set(activeScenarioContext());
    await expect(
      repository.finalizeRun(input)
    ).resolves.toEqual({ ok: false, code: 'EVIDENCE_MISMATCH' });
  });

  it('atomically finalizes a manifest-bound scenario with exact projected session evidence', async () => {
    const { firestore, repository } = fixture();
    await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .set(activeRunContext());
    await writeScenarioEvidence(firestore);
    await firestore
      .collection('intex_agent_matrix_corpus_scenario_contexts')
      .doc('context_1')
      .set(activeScenarioContext());
    await repository.createOrGet(
      testRunRecord({
        scenarios: Array.from({ length: 20 }, (_, index) =>
          index === 0
            ? testRunScenario(1, {
                lifecycle: 'running',
                sessionId: 'matrix_session_1',
                sessionBindingDigest: '9'.repeat(64),
              })
            : testRunScenario(index + 1)
        ),
      })
    );
    await repository.applyProjection({
      identity: identity(),
      command: {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: null,
        finalization: null,
      },
    });
    const projected = await repository.applyProjection({
      identity: identity(),
      command: scenarioProjectionCommand(),
    });
    if (!projected.ok) throw new Error('scenario projection fixture failed');
    await firestore
      .collection('intex_agent_sessions')
      .doc('matrix_session_1')
      .update({ lastEventSequence: 2 });
    const firstEvent = await firestore
      .collection('intex_agent_session_events')
      .doc('matrix_event_1')
      .get();
    await firestore.collection('intex_agent_session_events').doc('matrix_event_2').set({
      ...firstEvent.data(),
      id: 'matrix_event_2',
      eventSequence: 2,
    });
    const commandBase = scenarioProjectionCommand();
    const base = {
      ...commandBase,
      scenario: {
        ...commandBase.scenario,
        eventWatermark: 2,
        projection: { ...commandBase.scenario.projection, eventWatermark: 2 },
      },
    };
    const stopped = await repository.applyProjection({
      identity: identity(),
      command: {
        ...base,
        expectedRevision: projected.record.revision,
        scenario: {
          ...base.scenario,
          expectedScenarioRevision: 1,
          lifecycle: 'stopped',
          verdict: 'not_evaluated',
          summary: {
            ...base.scenario.summary,
            scenarioRevision: 2,
            lifecycle: 'stopped',
            verdict: 'not_evaluated',
          },
          projection: {
            ...base.scenario.projection,
            runRevision: 3,
            scenarioRevision: 2,
            lifecycle: 'stopped',
            verdict: 'not_evaluated',
          },
        },
      },
    });
    if (!stopped.ok) throw new Error(`scenario stop fixture failed: ${stopped.code}`);
    const staged = await stageArtifacts(repository, stopped.record.revision);
    const consistent = await repository.getScenarioConsistent({
      runId: 'run_1',
      scenarioId: 'scenario_001',
      userId: 'auth0:user_1',
    });
    if (!consistent.ok) throw new Error(`scenario read fixture failed: ${consistent.code}`);
    const projectionSnapshot = await firestore
      .collection('intex_agent_test_run_scenarios')
      .where('runId', '==', 'run_1')
      .get();
    const projectionDocument = projectionSnapshot.docs[0];
    if (projectionDocument === undefined) throw new Error('projection fixture missing');
    const contradictoryProjection = {
      ...consistent.projection,
      toolEvidence: [
        {
          event: 'selected' as const,
          toolName: 'create_note' as const,
          turnIndex: 0,
          ordinal: 1,
          facts: [],
        },
      ],
    };
    await projectionDocument.ref.set(contradictoryProjection);
    const contradictoryCandidate = terminalCandidate({
      artifactStageRevision: staged.record.revision,
      artifactCandidateDigest: staged.digest,
      projectionDigest: FirestoreTestRunRepository.digestProjection(staged.record, [
        contradictoryProjection,
      ]),
    });
    await expect(
      repository.finalizeRun({
        identity: identity(),
        expectedRevision: staged.record.revision,
        updatedAt: later,
        artifactStageDigest: staged.digest,
        terminalCandidate: contradictoryCandidate,
      })
    ).resolves.toEqual({ ok: false, code: 'EVIDENCE_MISMATCH' });
    await projectionDocument.ref.set(consistent.projection);
    const candidate = terminalCandidate({
      artifactStageRevision: staged.record.revision,
      artifactCandidateDigest: staged.digest,
      projectionDigest: FirestoreTestRunRepository.digestProjection(staged.record, [
        consistent.projection,
      ]),
    });
    const finalizationInput = {
      identity: identity(),
      expectedRevision: staged.record.revision,
      updatedAt: later,
      artifactStageDigest: staged.digest,
      terminalCandidate: candidate,
    };
    const sessionRef = firestore.collection('intex_agent_sessions').doc('matrix_session_1');
    const storedSession = await sessionRef.get();
    await sessionRef.delete();
    await expect(repository.finalizeRun(finalizationInput)).resolves.toEqual({
      ok: false,
      code: 'EVIDENCE_MISMATCH',
    });
    await sessionRef.set(storedSession.data() ?? {});
    const firstEventRef = firestore
      .collection('intex_agent_session_events')
      .doc('matrix_event_1');
    const storedFirstEvent = await firstEventRef.get();
    await firstEventRef.update({ userId: 'auth0:foreign' });
    await expect(repository.finalizeRun(finalizationInput)).resolves.toEqual({
      ok: false,
      code: 'EVENT_WATERMARK_GAP',
    });
    await firstEventRef.set(storedFirstEvent.data() ?? {});
    const secondEventRef = firestore
      .collection('intex_agent_session_events')
      .doc('matrix_event_2');
    const secondEvent = await secondEventRef.get();
    await secondEventRef.delete();
    await expect(repository.finalizeRun(finalizationInput)).resolves.toEqual({
      ok: false,
      code: 'EVENT_WATERMARK_GAP',
    });
    await secondEventRef.set(secondEvent.data() ?? {});

    const result = await repository.finalizeRun(finalizationInput);
    if (!result.ok) throw new Error(`scenario finalization failed: ${result.code}`);
    expect(result).toMatchObject({
      ok: true,
      disposition: 'applied',
      scenarioContextCount: 1,
      record: { lifecycle: 'finalizing', revision: 5 },
    });
    await expect(
      firestore.collection('intex_agent_matrix_corpus_scenario_contexts').doc('context_1').get()
    ).resolves.toMatchObject({ exists: false });
  });

  it('fails closed for every missing, corrupt, or foreign finalization root', async () => {
    const roots = [
      ['intex_agent_test_runs', 'run_1'],
      ['intex_agent_matrix_corpus_run_contexts', 'run_1'],
      ['intex_agent_matrix_corpus_run_manifests', 'run_1'],
    ] as const;
    for (const [collection, id] of roots) {
      const prepared = await prepareEmptyFinalizationFixture();
      await prepared.firestore.collection(collection).doc(id).delete();
      await expect(prepared.repository.finalizeRun(prepared.input)).resolves.toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
    }
    for (const [collection, id] of roots) {
      const prepared = await prepareEmptyFinalizationFixture();
      await prepared.firestore.collection(collection).doc(id).set({ corrupt: true });
      await expect(prepared.repository.finalizeRun(prepared.input)).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_RECORD',
      });
    }
    for (const [collection, id] of roots) {
      const prepared = await prepareEmptyFinalizationFixture();
      const ref = prepared.firestore.collection(collection).doc(id);
      const snapshot = await ref.get();
      await ref.set({ ...snapshot.data(), runId: 'run_foreign' });
      await expect(prepared.repository.finalizeRun(prepared.input)).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
    }
    {
      const prepared = await prepareEmptyFinalizationFixture();
      await prepared.firestore
        .collection('intex_agent_matrix_corpus_scenario_contexts')
        .doc('corrupt_scenario')
        .set({ runId: 'run_1', corrupt: true });
      await expect(prepared.repository.finalizeRun(prepared.input)).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_RECORD',
      });
    }
  });

  it('rejects each stale or inconsistent running finalization boundary', async () => {
    const mutations: readonly {
      name: string;
      mutate: (
        prepared: Awaited<ReturnType<typeof prepareEmptyFinalizationFixture>>
      ) => Promise<void>;
    }[] = [
      {
        name: 'invalidated context',
        mutate: async ({ firestore }): Promise<void> => {
          const ref = firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1');
          const snapshot = await ref.get();
          await ref.set({ ...snapshot.data(), invalidatedAt: later });
        },
      },
      {
        name: 'expired context',
        mutate: async ({ input }): Promise<void> => {
          (input as { updatedAt: string }).updatedAt = '2026-07-22T10:05:00.000Z';
          (input.terminalCandidate as { createdAt: string }).createdAt =
            '2026-07-22T10:05:00.000Z';
        },
      },
      {
        name: 'context catalog',
        mutate: async ({ firestore }): Promise<void> => {
          const ref = firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1');
          const snapshot = await ref.get();
          await ref.set({ ...snapshot.data(), catalogDigest: '9'.repeat(64) });
        },
      },
      {
        name: 'manifest catalog',
        mutate: async ({ firestore }): Promise<void> => {
          const ref = firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1');
          const snapshot = await ref.get();
          await ref.set({ ...snapshot.data(), catalogDigest: '9'.repeat(64) });
        },
      },
      {
        name: 'stage revision',
        mutate: async ({ firestore }): Promise<void> => {
          const ref = firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1');
          const snapshot = await ref.get();
          const artifactStage = snapshot.data()?.['artifactStage'] as Record<string, unknown>;
          await ref.set({ ...snapshot.data(), artifactStage: { ...artifactStage, revision: 99 } });
        },
      },
      {
        name: 'stage digest',
        mutate: async ({ firestore }): Promise<void> => {
          const ref = firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1');
          const snapshot = await ref.get();
          const artifactStage = snapshot.data()?.['artifactStage'] as Record<string, unknown>;
          await ref.set({
            ...snapshot.data(),
            artifactStage: {
              ...artifactStage,
              jsonCandidateDigest: '9'.repeat(64),
              compositeDigest: digestArtifactCandidates(
                '9'.repeat(64),
                String(artifactStage['markdownCandidateDigest'])
              ),
            },
          });
        },
      },
      {
        name: 'candidate digest',
        mutate: async ({ input }): Promise<void> => {
          (input.terminalCandidate as { artifactCandidateDigest: string }).artifactCandidateDigest =
            '9'.repeat(64);
        },
      },
      {
        name: 'existing candidate',
        mutate: async ({ firestore, input }): Promise<void> => {
          const ref = firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1');
          const snapshot = await ref.get();
          await ref.set({ ...snapshot.data(), terminalCandidate: input.terminalCandidate });
        },
      },
      {
        name: 'unexpected scenario',
        mutate: async ({ firestore }): Promise<void> => {
          await firestore
            .collection('intex_agent_matrix_corpus_scenario_contexts')
            .doc('unexpected_context')
            .set(activeScenarioContext());
        },
      },
    ];
    for (const { name, mutate } of mutations) {
      const prepared = await prepareEmptyFinalizationFixture();
      await mutate(prepared);
      const result = await prepared.repository.finalizeRun(prepared.input);
      expect(result, name).toEqual({
        ok: false,
        code: 'FINALIZATION_MISMATCH',
      });
    }
  });

  it('applies a signed terminal winner once and returns it for an opposing retry', async () => {
    const { firestore, repository } = fixture();
    await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .set(activeRunContext());
    await firestore
      .collection('intex_agent_matrix_corpus_run_manifests')
      .doc('run_1')
      .set(emptyRunManifest());
    await repository.createOrGet(testRunRecord());
    await repository.applyProjection({
      identity: identity(),
      command: {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: null,
        finalization: null,
      },
    });
    const staged = await stageArtifacts(repository, 1);
    const artifactStageDigest = staged.digest;
    const candidate = terminalCandidate({
      artifactStageRevision: staged.record.revision,
      artifactCandidateDigest: staged.digest,
      projectionDigest: FirestoreTestRunRepository.digestProjection(staged.record, []),
    });
    const finalized = await repository.finalizeRun({
      identity: identity(),
      expectedRevision: 2,
      updatedAt: later,
      artifactStageDigest,
      terminalCandidate: candidate,
    });
    if (!finalized.ok) throw new Error('finalization fixture transition failed');
    const tombstoneDigest = finalized.tombstoneDigest;
    const digest = FirestoreTestRunRepository.digestTerminalCandidate(candidate);
    const release = await repository.applyTerminalControl({
      identity: identity(),
      command: {
        kind: 'release',
        eventId: 'terminal_event_1',
        payloadDigest: 'f'.repeat(64),
        tombstoneDigest,
        terminalCandidateDigest: digest,
        artifactStageDigest,
        acknowledgedAt: later,
      },
    });
    expect(release).toMatchObject({
      ok: true,
      disposition: 'applied',
      record: { lifecycle: 'stopped', verdict: 'not_evaluated' },
    });
    await expect(
      repository.applyTerminalControl({
        identity: identity(),
        command: {
          kind: 'abandoned',
          eventId: 'abandoned_event_2',
          payloadDigest: '1'.repeat(64),
          acknowledgedAt: later,
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
      record: { terminalWinner: { kind: 'release', eventId: 'terminal_event_1' } },
    });
  });

  it('fails closed across terminal-control roots and applies abandonment without a candidate', async () => {
    const command = {
      kind: 'abandoned' as const,
      eventId: 'abandoned_event_1',
      payloadDigest: 'f'.repeat(64),
      acknowledgedAt: later,
    };
    {
      const { repository } = fixture();
      await expect(
        repository.applyTerminalControl({
          identity: { ...identity(), leaseFence: '0' },
          command,
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
      await expect(
        repository.applyTerminalControl({ identity: identity(), command })
      ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    }
    {
      const { firestore, repository } = fixture();
      await firestore.collection('intex_agent_test_runs').doc('run_1').set({ corrupt: true });
      await expect(
        repository.applyTerminalControl({ identity: identity(), command })
      ).resolves.toEqual({ ok: false, code: 'CORRUPT_RECORD' });
    }
    {
      const { firestore, repository } = fixture();
      await firestore.collection('intex_agent_test_runs').doc('run_1').set(
        testRunRecord({ userId: 'auth0:foreign' })
      );
      await expect(
        repository.applyTerminalControl({ identity: identity(), command })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    }
    {
      const { repository } = fixture();
      await repository.createOrGet(testRunRecord());
      await expect(
        repository.applyTerminalControl({ identity: identity(), command })
      ).resolves.toEqual({ ok: false, code: 'INVALID_TRANSITION' });
      await repository.applyProjection({
        identity: identity(),
        command: {
          expectedRevision: 0,
          nextLifecycle: 'running',
          updatedAt: later,
          scenario: null,
          finalization: null,
        },
      });
      await expect(
        repository.applyTerminalControl({ identity: identity(), command })
      ).resolves.toMatchObject({
        ok: true,
        disposition: 'applied',
        record: { lifecycle: 'stopped', terminalWinner: { kind: 'abandoned' } },
      });
    }
  });

  it('rejects invalid finalization input and conflicting artifact-stage state', async () => {
    {
      const { repository } = fixture();
      await expect(
        repository.finalizeRun({
          identity: identity(),
          expectedRevision: -1,
          updatedAt: later,
          artifactStageDigest: 'e'.repeat(64),
          terminalCandidate: terminalCandidate(),
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
    }
    {
      const { firestore, repository } = fixture();
      await repository.createOrGet(testRunRecord());
      await firestore
        .collection('intex_agent_matrix_corpus_run_manifests')
        .doc('run_1')
        .set(emptyRunManifest());
      await expect(
        repository.applyArtifactDelivery({
          identity: identity(),
          command: {
            expectedRevision: 0,
            updatedAt: later,
            next: { status: 'ready', terminalControlEventId: 'terminal_event_1' },
          },
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    }
    {
      const { firestore, repository } = fixture();
      await repository.createOrGet(testRunRecord());
      await repository.applyProjection({
        identity: identity(),
        command: {
          expectedRevision: 0,
          nextLifecycle: 'running',
          updatedAt: later,
          scenario: null,
          finalization: null,
        },
      });
      const jsonCandidateDigest = '1'.repeat(64);
      const markdownCandidateDigest = '2'.repeat(64);
      await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').set({
        ...emptyRunManifest(),
        artifactStage: {
          revision: 1,
          jsonCandidateDigest,
          markdownCandidateDigest,
          compositeDigest: digestArtifactCandidates(jsonCandidateDigest, markdownCandidateDigest),
          stagedAt: later,
        },
      });
      await expect(
        repository.applyArtifactDelivery({
          identity: identity(),
          command: {
            expectedRevision: 1,
            updatedAt: later,
            next: { status: 'staged', jsonCandidateDigest, markdownCandidateDigest },
          },
        })
      ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    }
  });

  it('atomically tombstones active context when abandoned recovery stops a running run', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').set(
      activeRunContext()
    );
    await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').set(
      emptyRunManifest()
    );
    await repository.createOrGet(testRunRecord());
    await repository.applyProjection({
      identity: identity(),
      command: {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: null,
        finalization: null,
      },
    });
    await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      winner: {
        kind: 'abandoned',
        eventId: 'abandoned_event_1',
        outcome: 'stopped_not_evaluated',
      },
    });
    const context = await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .get();
    expect(context.data()).toMatchObject({ status: 'finalized', finalizedAt: later });
    await expect(repository.getExact(identity())).resolves.toMatchObject({
      ok: true,
      record: { lifecycle: 'stopped', verdict: 'not_evaluated' },
    });
  });

  it('tombstones and deletes a manifest-bound active scenario during abandoned recovery', async () => {
    const { firestore, repository } = fixture();
    await createRunningScenarioRun(repository);
    await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .set(activeRunContext());
    await writeScenarioEvidence(firestore);
    await firestore
      .collection('intex_agent_matrix_corpus_scenario_contexts')
      .doc('scenario_context_1')
      .set(activeScenarioContext());
    await writeTestConfirmation(firestore, {
      confirmationId: 'confirmation_1',
      runId: 'run_1',
      scenarioId: 'scenario_001',
      sessionId: 'matrix_session_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
    });

    await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      winner: { kind: 'abandoned', outcome: 'stopped_not_evaluated' },
    });
    await expect(
      firestore
        .collection('intex_agent_matrix_corpus_scenario_contexts')
        .doc('scenario_context_1')
        .get()
    ).resolves.toMatchObject({ exists: false });
  });

  it('rejects an AEAD-valid confirmation outside the exact manifest session binding', async () => {
    const { firestore, repository } = fixture();
    await createRunningScenarioRun(repository);
    await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .set(activeRunContext());
    await writeScenarioEvidence(firestore);
    await firestore
      .collection('intex_agent_matrix_corpus_scenario_contexts')
      .doc('scenario_context_1')
      .set(activeScenarioContext());
    await writeTestConfirmation(firestore, {
      confirmationId: 'confirmation_1',
      runId: 'run_1',
      scenarioId: 'scenario_001',
      sessionId: 'orphan_session_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
    });

    await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
  });

  it('validates abandoned recovery commands and stored receipts field by field', async () => {
    for (const invalidInput of [
      { ...abandonedRecovery(), identity: { ...identity(), userId: '' } },
      {
        ...abandonedRecovery(),
        command: { ...abandonedRecovery().command, eventId: '' },
      },
      {
        ...abandonedRecovery(),
        command: { ...abandonedRecovery().command, payloadDigest: 'invalid' },
      },
      {
        ...abandonedRecovery(),
        command: { ...abandonedRecovery().command, acknowledgedAt: 'invalid' },
      },
    ]) {
      const { repository } = fixture();
      await expect(repository.applyAbandonedRecovery(invalidInput)).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
    }

    const validReceipt = {
      version: 1,
      runtimeAudience: 'hetzner-prod',
      ...identity(),
      eventId: 'abandoned_event_1',
      payloadDigest: 'f'.repeat(64),
      outcome: 'provisioning_noop',
      acknowledgedAt: later,
    };
    const invalidReceipts: unknown[] = [
      null,
      [],
      { ...validReceipt, extra: true },
      { ...validReceipt, version: 2 },
      { ...validReceipt, runtimeAudience: 'production' },
      { ...validReceipt, runId: 1 },
      { ...validReceipt, userId: 1 },
      { ...validReceipt, leaseFence: 7 },
      { ...validReceipt, eventId: 1 },
      { ...validReceipt, payloadDigest: 1 },
      { ...validReceipt, acknowledgedAt: 1 },
      { ...validReceipt, runId: '' },
      { ...validReceipt, eventId: '' },
      { ...validReceipt, payloadDigest: 'invalid' },
      { ...validReceipt, acknowledgedAt: 'invalid' },
      { ...validReceipt, outcome: 'invalid' },
    ];
    for (const receipt of invalidReceipts) {
      const { firestore, repository } = fixture();
      await firestore
        .collection('intex_agent_matrix_corpus_recovery_receipts')
        .doc('run_1')
        .set(receipt as never);
      await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_RECORD',
      });
    }

    {
      const { firestore, repository } = fixture();
      await firestore
        .collection('intex_agent_matrix_corpus_recovery_receipts')
        .doc('run_1')
        .set({ ...validReceipt, runId: 'run_other' });
      await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
    }
  });

  it('fails closed for corrupt and foreign abandoned-recovery provisioning roots', async () => {
    for (const corruptRoot of ['run', 'context', 'manifest', 'scenario'] as const) {
      const { firestore, repository } = fixture();
      if (corruptRoot === 'run')
        await firestore.collection('intex_agent_test_runs').doc('run_1').set({ corrupt: true });
      if (corruptRoot === 'context')
        await firestore
          .collection('intex_agent_matrix_corpus_run_contexts')
          .doc('run_1')
          .set({ corrupt: true });
      if (corruptRoot === 'manifest')
        await firestore
          .collection('intex_agent_matrix_corpus_run_manifests')
          .doc('run_1')
          .set({ corrupt: true });
      if (corruptRoot === 'scenario')
        await firestore
          .collection('intex_agent_matrix_corpus_scenario_contexts')
          .doc('scenario_context_1')
          .set({ runId: 'run_1', corrupt: true });
      await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
        ok: false,
        code: 'CORRUPT_RECORD',
      });
    }

    for (const foreignRoot of ['run', 'context', 'manifest', 'scenario'] as const) {
      const { firestore, repository } = fixture();
      if (foreignRoot === 'run')
        await firestore.collection('intex_agent_test_runs').doc('run_1').set(
          testRunRecord({ userId: 'auth0:foreign' })
        );
      if (foreignRoot === 'context')
        await firestore
          .collection('intex_agent_matrix_corpus_run_contexts')
          .doc('run_1')
          .set({ ...activeRunContext(), userId: 'auth0:foreign' });
      if (foreignRoot === 'manifest')
        await firestore
          .collection('intex_agent_matrix_corpus_run_manifests')
          .doc('run_1')
          .set({ ...emptyRunManifest(), leaseFence: '8' });
      if (foreignRoot === 'scenario')
        await firestore
          .collection('intex_agent_matrix_corpus_scenario_contexts')
          .doc('scenario_context_1')
          .set({ ...activeScenarioContext(), userId: 'auth0:foreign' });
      await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
    }
  });

  it('checks each abandoned-recovery execution-evidence owner and fence', async () => {
    const cases = [
      {
        collection: 'intex_agent_sessions',
        id: 'session_1',
        value: {
          userId: 'auth0:foreign',
          matrixCorpusProfile: { runId: 'run_1', leaseFence: '7' },
        },
        code: 'CORRELATED_REPLAY_CONFLICT',
      },
      {
        collection: 'intex_agent_matrix_corpus_ingest_receipts',
        id: 'ingest_1',
        value: { runId: 'run_1', leaseFence: '8' },
        code: 'CORRELATED_REPLAY_CONFLICT',
      },
      {
        collection: 'intex_agent_matrix_corpus_ingest_receipts',
        id: 'ingest_1',
        value: { runId: 'run_1', leaseFence: '7' },
        code: 'EVIDENCE_MISMATCH',
      },
    ] as const;
    for (const evidence of cases) {
      const { firestore, repository } = fixture();
      await repository.createOrGet(testRunRecord());
      await firestore.collection(evidence.collection).doc(evidence.id).set(evidence.value);
      await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
        ok: false,
        code: evidence.code,
      });
    }

    for (const owner of [
      { userId: 'auth0:foreign', code: 'CORRELATED_REPLAY_CONFLICT' },
      { userId: 'auth0:user_1', code: 'EVIDENCE_MISMATCH' },
    ] as const) {
      const { firestore, repository } = fixture();
      await repository.createOrGet(testRunRecord());
      await writeTestConfirmation(firestore, {
        confirmationId: 'confirmation_1',
        runId: 'run_1',
        scenarioId: 'scenario_001',
        sessionId: 'matrix_session_1',
        userId: owner.userId,
        leaseFence: '7',
      });
      await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
        ok: false,
        code: owner.code,
      });
    }
  });

  it('recovers a finalizing run only with its exact finalized context tombstone', async () => {
    const { firestore, repository } = fixture();
    await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .set(activeRunContext());
    await firestore
      .collection('intex_agent_matrix_corpus_run_manifests')
      .doc('run_1')
      .set(emptyRunManifest());
    await repository.createOrGet(testRunRecord());
    await repository.applyProjection({
      identity: identity(),
      command: {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: null,
        finalization: null,
      },
    });
    const staged = await stageArtifacts(repository, 1);
    const candidate = terminalCandidate({
      artifactStageRevision: staged.record.revision,
      artifactCandidateDigest: staged.digest,
      projectionDigest: FirestoreTestRunRepository.digestProjection(staged.record, []),
    });
    const finalized = await repository.finalizeRun({
      identity: identity(),
      expectedRevision: staged.record.revision,
      updatedAt: later,
      artifactStageDigest: staged.digest,
      terminalCandidate: candidate,
    });
    expect(finalized).toMatchObject({ ok: true });

    await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      winner: { kind: 'abandoned', outcome: 'stopped_not_evaluated' },
    });

    const second = fixture();
    await second.firestore.collection('intex_agent_test_runs').doc('run_1').set(
      testRunRecord({
        lifecycle: 'finalizing',
        revision: 3,
        artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
        contextFinalizationTombstoneDigest: 'd'.repeat(64),
        artifactStageDigest: staged.digest,
        terminalCandidate: candidate,
      })
    );
    await second.firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .set({
        version: 1,
        status: 'finalized',
        runtimeAudience: 'hetzner-prod',
        ...identity(),
        scenarioContextCount: 0,
        finalizedAt: later,
      });
    await second.firestore
      .collection('intex_agent_matrix_corpus_run_manifests')
      .doc('run_1')
      .set(emptyRunManifest());
    await expect(second.repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
      ok: false,
      code: 'FINALIZATION_MISMATCH',
    });
  });

  it('persists an idempotent no-op winner when abandoned recovery finds no provisioning', async () => {
    const { firestore, repository } = fixture();

    await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      winner: { outcome: 'provisioning_noop' },
    });
    await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
      winner: { outcome: 'provisioning_noop' },
    });
    const receipt = await firestore
      .collection('intex_agent_matrix_corpus_recovery_receipts')
      .doc('run_1')
      .get();
    expect(receipt.data()).toMatchObject({ outcome: 'provisioning_noop' });
    await expect(repository.createOrGet(testRunRecord())).resolves.toEqual({
      ok: false,
      code: 'TERMINAL_CONFLICT',
    });
  });

  it('atomically rolls back partial preflight provisioning without execution evidence', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').set(
      activeRunContext()
    );
    await repository.createOrGet(testRunRecord());

    await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      winner: { outcome: 'provisioning_rolled_back' },
    });
    await expect(repository.getExact(identity())).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    const context = await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .get();
    expect(context.exists).toBe(false);
  });

  it('rolls back every preflight provisioning root, including manifest and scenario context', async () => {
    const { firestore, repository } = fixture();
    await repository.createOrGet(testRunRecord());
    await firestore
      .collection('intex_agent_matrix_corpus_run_contexts')
      .doc('run_1')
      .set(activeRunContext());
    await firestore
      .collection('intex_agent_matrix_corpus_run_manifests')
      .doc('run_1')
      .set(emptyRunManifest());
    await firestore
      .collection('intex_agent_matrix_corpus_scenario_contexts')
      .doc('scenario_context_1')
      .set(activeScenarioContext());

    await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      winner: { outcome: 'provisioning_rolled_back' },
    });
    for (const [collection, id] of [
      ['intex_agent_test_runs', 'run_1'],
      ['intex_agent_matrix_corpus_run_contexts', 'run_1'],
      ['intex_agent_matrix_corpus_run_manifests', 'run_1'],
      ['intex_agent_matrix_corpus_scenario_contexts', 'scenario_context_1'],
    ] as const) {
      await expect(firestore.collection(collection).doc(id).get()).resolves.toMatchObject({
        exists: false,
      });
    }
  });

  it('returns an already-terminal run and rejects running recovery without both roots', async () => {
    {
      const { firestore, repository } = fixture();
      await firestore.collection('intex_agent_test_runs').doc('run_1').set(
        testRunRecord({
          lifecycle: 'stopped',
          verdict: 'not_evaluated',
          finishedAt: later,
          terminalWinner: {
            kind: 'abandoned',
            eventId: 'existing_abandoned_event',
            payloadDigest: 'e'.repeat(64),
            outcome: 'stopped_not_evaluated',
            acknowledgedAt: later,
          },
        })
      );
      await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toMatchObject({
        ok: true,
        disposition: 'already_applied',
        winner: { kind: 'abandoned', eventId: 'existing_abandoned_event' },
      });
    }
    for (const presentRoot of ['context', 'manifest'] as const) {
      const { firestore, repository } = fixture();
      await createRunningScenarioRun(repository);
      if (presentRoot === 'context')
        await firestore
          .collection('intex_agent_matrix_corpus_run_contexts')
          .doc('run_1')
          .set(activeRunContext());
      if (presentRoot === 'manifest')
        await firestore
          .collection('intex_agent_matrix_corpus_run_manifests')
          .doc('run_1')
          .set(emptyRunManifest());
      await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
        ok: false,
        code: 'FINALIZATION_MISMATCH',
      });
    }
  });

  it('rejects inconsistent running and finalizing abandoned-recovery boundaries', async () => {
    {
      const { firestore, repository } = fixture();
      await createRunningScenarioRun(repository);
      await firestore
        .collection('intex_agent_matrix_corpus_run_contexts')
        .doc('run_1')
        .set(activeRunContext());
      await firestore
        .collection('intex_agent_matrix_corpus_run_manifests')
        .doc('run_1')
        .set({ ...emptyRunManifest(), catalogDigest: '9'.repeat(64) });
      await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
        ok: false,
        code: 'FINALIZATION_MISMATCH',
      });
    }
    {
      const { firestore, repository } = fixture();
      await createRunningScenarioRun(repository);
      await firestore
        .collection('intex_agent_matrix_corpus_run_contexts')
        .doc('run_1')
        .set(activeRunContext());
      await firestore
        .collection('intex_agent_matrix_corpus_run_manifests')
        .doc('run_1')
        .set({
          ...emptyRunManifest(),
          scenarioBindings: [
            {
              scenarioId: 'scenario_001',
              scenarioNumber: 1,
              scenarioLabel: 'Scenario 001/020',
              sessionId: 'matrix_session_1',
            },
          ],
        });
      await firestore
        .collection('intex_agent_matrix_corpus_scenario_contexts')
        .doc('foreign_scenario')
        .set({ ...activeScenarioContext(), scenarioId: 'scenario_002' });
      await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
        ok: false,
        code: 'FINALIZATION_MISMATCH',
      });
    }
    {
      const prepared = await prepareEmptyFinalizationFixture();
      const finalized = await prepared.repository.finalizeRun(prepared.input);
      if (!finalized.ok) throw new Error('finalizing fixture failed');
      await prepared.firestore
        .collection('intex_agent_matrix_corpus_run_contexts')
        .doc('run_1')
        .set(activeRunContext());
      await expect(
        prepared.repository.applyAbandonedRecovery(abandonedRecovery())
      ).resolves.toEqual({ ok: false, code: 'FINALIZATION_MISMATCH' });
    }
  });

  it('fails closed instead of rolling back provisioning with session evidence', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').set(
      activeRunContext()
    );
    await repository.createOrGet(testRunRecord());
    await firestore.collection('intex_agent_sessions').doc('session_1').set({
      userId: 'auth0:user_1',
      matrixCorpusProfile: { runId: 'run_1', leaseFence: '7' },
    });

    await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
      ok: false,
      code: 'EVIDENCE_MISMATCH',
    });
    await expect(repository.getExact(identity())).resolves.toMatchObject({ ok: true });
  });

  it('rejects abandoned recovery when same-run session evidence carries another lease fence', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').set(
      activeRunContext()
    );
    await repository.createOrGet(testRunRecord());
    await firestore.collection('intex_agent_sessions').doc('session_wrong_fence').set({
      userId: 'auth0:user_1',
      matrixCorpusProfile: { runId: 'run_1', leaseFence: '8' },
    });

    await expect(repository.applyAbandonedRecovery(abandonedRecovery())).resolves.toEqual({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(repository.getExact(identity())).resolves.toMatchObject({ ok: true });
    await expect(
      firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_1').get()
    ).resolves.toMatchObject({ exists: true });
  });

  it('rejects corrupt stored records without returning private document data', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_test_runs').doc('run_1').set({
      ...testRunRecord(),
      agentModel: 'or:google/gemini-3-flash-preview',
      privatePrompt: 'must not leak',
    });

    await expect(repository.getExact(identity())).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_RECORD',
    });
  });

  it('derives the closed current-acceptance admission gate without exposing records', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_test_runs').doc('run_legacy').set({
      ...testRunRecord({ runId: 'run_legacy' }),
      runtimeAudience: 'home-dev',
    });
    await expect(repository.getCurrentAcceptance('auth0:user_1')).resolves.toEqual({
      ok: true,
      acceptance: { kind: 'admission_ready', current: 'absent' },
    });
    await repository.createOrGet(testRunRecord());
    await expect(repository.getCurrentAcceptance('auth0:user_1')).resolves.toEqual({
      ok: true,
      acceptance: { kind: 'admission_blocked', reason: 'preflight' },
    });

    const terminal = testRunRecord({
      runId: 'run_terminal',
      lifecycle: 'completed',
      verdict: 'passed',
      finishedAt: later,
      artifactDelivery: { status: 'ready', failureCode: null, updatedAt: later },
      terminalWinner: {
        kind: 'release',
        eventId: 'terminal_event_2',
        payloadDigest: 'f'.repeat(64),
        outcome: 'completed_passed',
        acknowledgedAt: later,
      },
    });
    await firestore.collection('intex_agent_test_runs').doc('run_1').delete();
    await firestore.collection('intex_agent_test_runs').doc('run_terminal').set(terminal);
    await expect(repository.getCurrentAcceptance('auth0:user_1')).resolves.toEqual({
      ok: true,
      acceptance: { kind: 'admission_ready', current: 'terminal_artifact_ready' },
    });
  });

  it.each([
    [
      { status: 'pending', failureCode: null, updatedAt: later },
      { kind: 'admission_blocked', reason: 'artifact_pending' },
    ],
    [
      { status: 'staged', failureCode: null, updatedAt: later },
      { kind: 'admission_blocked', reason: 'artifact_staged' },
    ],
    [
      {
        status: 'unknown',
        failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT',
        updatedAt: later,
      },
      { kind: 'admission_ready', current: 'terminal_artifact_unknown' },
    ],
    [
      { status: 'failed', failureCode: 'REPORT_PUBLICATION_FAILED', updatedAt: later },
      { kind: 'admission_ready', current: 'terminal_artifact_failed' },
    ],
  ] as const)('classifies terminal artifact admission state %#', async (artifactDelivery, expected) => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_test_runs').doc('run_terminal').set(
      testRunRecord({
        runId: 'run_terminal',
        lifecycle: 'completed',
        verdict: 'passed',
        finishedAt: later,
        artifactDelivery,
        terminalWinner: {
          kind: 'release',
          eventId: 'terminal_event_2',
          payloadDigest: 'f'.repeat(64),
          outcome: 'completed_passed',
          acknowledgedAt: later,
        },
      })
    );

    await expect(repository.getCurrentAcceptance('auth0:user_1')).resolves.toEqual({
      ok: true,
      acceptance: expected,
    });
  });

  it('blocks admission when any older Home Dev record is still current', async () => {
    const { firestore, repository } = fixture();
    await firestore.collection('intex_agent_test_runs').doc('run_current').set(
      testRunRecord({
        runId: 'run_current',
        startedAt: '2026-07-20T09:00:00.000Z',
        updatedAt: '2026-07-20T09:00:00.000Z',
        lifecycle: 'running',
      })
    );
    await firestore.collection('intex_agent_test_runs').doc('run_newer_terminal').set(
      testRunRecord({
        runId: 'run_newer_terminal',
        startedAt: '2026-07-20T11:00:00.000Z',
        updatedAt: '2026-07-20T11:00:00.000Z',
        finishedAt: '2026-07-20T11:05:00.000Z',
        lifecycle: 'completed',
        verdict: 'passed',
        artifactDelivery: {
          status: 'ready',
          failureCode: null,
          updatedAt: '2026-07-20T11:05:00.000Z',
        },
        terminalWinner: {
          kind: 'release',
          eventId: 'terminal_event_newer',
          payloadDigest: 'f'.repeat(64),
          outcome: 'completed_passed',
          acknowledgedAt: '2026-07-20T11:05:00.000Z',
        },
      })
    );

    await expect(repository.getCurrentAcceptance('auth0:user_1')).resolves.toEqual({
      ok: true,
      acceptance: { kind: 'admission_blocked', reason: 'running' },
    });
  });
});

function terminalCandidate(
  overrides: Partial<MatrixCorpusTerminalCandidateV1> = {}
): MatrixCorpusTerminalCandidateV1 {
  return {
    version: 1 as const,
    runId: 'run_1',
    userId: 'auth0:user_1',
    leaseFence: '7',
    outcome: 'stopped_not_evaluated' as const,
    projectionDigest: 'b'.repeat(64),
    artifactStageRevision: 2,
    artifactCandidateDigest: 'c'.repeat(64),
    createdAt: later,
    ...overrides,
  };
}

function abandonedRecovery(): Parameters<TestRunRepository['applyAbandonedRecovery']>[0] {
  return {
    identity: identity(),
    command: {
      kind: 'abandoned' as const,
      eventId: 'abandoned_event_1',
      payloadDigest: 'f'.repeat(64),
      acknowledgedAt: later,
    },
  };
}

function activeRunContext(): MatrixCorpusPrivateRunContextV1 {
  return {
    version: 1,
    status: 'active',
    runtimeAudience: 'hetzner-prod',
    runId: 'run_1',
    userId: 'auth0:user_1',
    leaseFence: '7',
    catalogDigest: 'a'.repeat(64),
    agentModel: 'or:deepseek/deepseek-v4-flash',
    evaluatorModel: 'or:minimax/minimax-m3',
    promptPreferencesVersion: 2,
    promptPreferencesDigest: 'b'.repeat(64),
    encryptedPromptContext: {
      algorithm: 'aes-256-gcm',
      keyVersion: 'key_v1',
      nonce: Buffer.alloc(12).toString('base64url'),
      ciphertext: Buffer.from('context').toString('base64url'),
      authenticationTag: Buffer.alloc(16).toString('base64url'),
    },
    userTimeZone: 'Europe/Warsaw',
    createdAt: '2026-07-20T10:00:00.000Z',
    expiresAt: '2026-07-21T10:00:00.000Z',
    invalidatedAt: null,
  };
}

function activeScenarioContext(): MatrixCorpusPrivateScenarioContextV1 {
  return {
    version: 1,
    runtimeAudience: 'hetzner-prod',
    runId: 'run_1',
    scenarioId: 'scenario_001',
    userId: 'auth0:user_1',
    leaseFence: '7',
    baselinePromptPreferencesDigest: 'b'.repeat(64),
    overlayVersion: 0,
    overlayDigest: 'c'.repeat(64),
    encryptedEffectivePromptContext: {
      algorithm: 'aes-256-gcm',
      keyVersion: 'key_v1',
      nonce: Buffer.alloc(12).toString('base64url'),
      ciphertext: Buffer.from('scenario context').toString('base64url'),
      authenticationTag: Buffer.alloc(16).toString('base64url'),
    },
    lastAppliedMutationReceipt: null,
    expiresAt: '2026-07-21T10:00:00.000Z',
    invalidatedAt: null,
  };
}

function emptyRunManifest(): MatrixCorpusRunManifestV1 {
  return {
    version: 1,
    runtimeAudience: 'hetzner-prod',
    runId: 'run_1',
    userId: 'auth0:user_1',
    leaseFence: '7',
    catalogDigest: 'a'.repeat(64),
    scenarioBindings: [],
    artifactStage: null,
    terminalCandidate: null,
    createdAt: '2026-07-20T10:00:00.000Z',
  };
}

async function createRunningScenarioRun(repository: FirestoreTestRunRepository): Promise<void> {
  await repository.createOrGet(testRunRecord());
  const running = await repository.applyProjection({
    identity: identity(),
    command: {
      expectedRevision: 0,
      nextLifecycle: 'running',
      updatedAt: later,
      scenario: null,
      finalization: null,
    },
  });
  if (!running.ok) throw new Error('running fixture transition failed');
}

async function writeTestConfirmation(
  firestore: Firestore,
  identity: Readonly<{
    confirmationId: string;
    runId: string;
    scenarioId: string;
    sessionId: string;
    userId: string;
    leaseFence: string;
  }>
): Promise<void> {
  const repository = new FirestoreTestConfirmationRepository({
    firestore,
    crypto: contextCrypto(),
  });
  const result = await repository.createOrGet({
    identity,
    toolName: 'create_note',
    toolArgs: { content: 'Synthetic Matrix confirmation' },
    selectionTurnIndex: 0,
    selectionOrdinal: 1,
    createdAt: '2026-07-20T10:00:00.000Z',
    expiresAt: '2026-07-20T10:05:00.000Z',
  });
  if (!result.ok) throw new Error('confirmation fixture creation failed');
}

async function prepareEmptyFinalizationFixture(): Promise<
  Readonly<{
    firestore: Firestore;
    repository: FirestoreTestRunRepository;
    input: Parameters<TestRunRepository['finalizeRun']>[0];
  }>
> {
  const { firestore, repository } = fixture();
  await firestore
    .collection('intex_agent_matrix_corpus_run_contexts')
    .doc('run_1')
    .set(activeRunContext());
  await firestore
    .collection('intex_agent_matrix_corpus_run_manifests')
    .doc('run_1')
    .set(emptyRunManifest());
  await repository.createOrGet(testRunRecord());
  await repository.applyProjection({
    identity: identity(),
    command: {
      expectedRevision: 0,
      nextLifecycle: 'running',
      updatedAt: later,
      scenario: null,
      finalization: null,
    },
  });
  const staged = await stageArtifacts(repository, 1);
  const candidate = terminalCandidate({
    artifactStageRevision: staged.record.revision,
    artifactCandidateDigest: staged.digest,
    projectionDigest: FirestoreTestRunRepository.digestProjection(staged.record, []),
  });
  return {
    firestore,
    repository,
    input: {
      identity: identity(),
      expectedRevision: staged.record.revision,
      updatedAt: later,
      artifactStageDigest: staged.digest,
      terminalCandidate: candidate,
    },
  };
}

async function stageArtifacts(
  repository: FirestoreTestRunRepository,
  expectedRevision: number
): Promise<Readonly<{ digest: string; record: IntexAgentTestRunRecordV1 }>> {
  const result = await repository.applyArtifactDelivery({
    identity: identity(),
    command: {
      expectedRevision,
      updatedAt: later,
      next: {
        status: 'staged',
        jsonCandidateDigest: '1'.repeat(64),
        markdownCandidateDigest: '2'.repeat(64),
      },
    },
  });
  if (!result.ok || result.record.artifactStageDigest === null)
    throw new Error('artifact staging fixture failed');
  return { digest: result.record.artifactStageDigest, record: result.record };
}

function scenarioProjectionCommand(): TestRunProjectionCasCommandV1 &
  Readonly<{ scenario: NonNullable<TestRunProjectionCasCommandV1['scenario']> }> {
  const summary = testRunScenario(1, {
    scenarioRevision: 1,
    lifecycle: 'running',
  });
  return {
    expectedRevision: 1,
    nextLifecycle: 'running' as const,
    updatedAt: later,
    scenario: {
      scenarioId: 'scenario_001',
      expectedScenarioRevision: 0,
      eventWatermark: 1,
      lifecycle: 'running' as const,
      verdict: 'pending' as const,
      sessionId: 'matrix_session_1',
      sessionBindingDigest: '9'.repeat(64),
      summary: {
        scenarioId: summary.scenarioId,
        scenarioNumber: summary.scenarioNumber,
        scenarioLabel: summary.scenarioLabel,
        scenarioRevision: summary.scenarioRevision,
        lifecycle: summary.lifecycle,
        verdict: summary.verdict,
        plannedTurns: summary.plannedTurns,
        completedTurns: summary.completedTurns,
        expectedReplies: summary.expectedReplies,
        completedReplies: summary.completedReplies,
        selectedTools: summary.selectedTools,
        deterministicVerdict: summary.deterministicVerdict,
        semanticVerdict: summary.semanticVerdict,
        startedAt: summary.startedAt,
        finishedAt: summary.finishedAt,
        durationMs: summary.durationMs,
      },
      projection: {
        schemaVersion: 1 as const,
        runId: 'run_1',
        userId: 'auth0:user_1',
        sessionId: 'matrix_session_1',
        sessionBindingDigest: '9'.repeat(64),
        scenarioId: 'scenario_001',
        scenarioNumber: 1,
        scenarioLabel: 'Scenario 001/020',
        runRevision: 2,
        scenarioRevision: 1,
        eventWatermark: 1,
        lifecycle: 'running' as const,
        verdict: 'pending' as const,
        plannedTurns: 1,
        completedTurns: 0,
        toolEvidence: [],
        deterministicChecks: [],
        replyEvaluations: [],
        agentUsage: [],
      },
    },
    finalization: null,
  };
}

async function writeScenarioEvidence(
  firestore: Firestore,
  options: Readonly<{ manifestSessionId?: string }> = {}
): Promise<void> {
  const mockProfile = {
    version: 1 as const,
    calls: [],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution' as const,
  };
  await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_1').set({
    version: 1,
    runtimeAudience: 'hetzner-prod',
    runId: 'run_1',
    userId: 'auth0:user_1',
    leaseFence: '7',
    catalogDigest: 'a'.repeat(64),
    scenarioBindings: [
      {
        scenarioId: 'scenario_001',
        scenarioNumber: 1,
        scenarioLabel: 'Scenario 001/020',
        sessionId: options.manifestSessionId ?? 'matrix_session_1',
      },
    ],
    artifactStage: null,
    terminalCandidate: null,
    createdAt: later,
  });
  await firestore.collection('intex_agent_sessions').doc('matrix_session_1').set({
    id: 'matrix_session_1',
    userId: 'auth0:user_1',
    channel: 'whatsapp',
    status: 'active',
    startedAt: later,
    lastUserMessageAt: later,
    startReason: 'no_active_session',
    matrixCorpusProfile: {
      version: 1,
      kind: 'matrix_corpus',
      runtimeAudience: 'hetzner-prod',
      leaseFence: '7',
      runId: 'run_1',
      scenarioId: 'scenario_001',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario 001/020',
      executionMode: 'strict_mock_tools',
      agentModel: 'or:deepseek/deepseek-v4-flash',
      evaluatorModel: 'or:minimax/minimax-m3',
      promptPreferencesVersion: 2,
      promptPreferencesDigest: 'b'.repeat(64),
      userTimeZone: 'Europe/Warsaw',
      mockProfile,
      mockProfileDigest: createHash('sha256')
        .update(canonicalMatrixCorpusStrictToolMockProfileV1(mockProfile), 'utf8')
        .digest('hex'),
      expectedToolSchedule: [],
    },
    lastEventSequence: 1,
  });
  await firestore.collection('intex_agent_session_events').doc('matrix_event_1').set({
    id: 'matrix_event_1',
    sessionId: 'matrix_session_1',
    userId: 'auth0:user_1',
    type: 'user_message',
    payload: { phase: 'start', turnIndex: 0 },
    createdAt: later,
    eventSequence: 1,
  });
}

function injectNextTransactionMutation(
  firestore: Firestore,
  mutate: () => Promise<void>
): void {
  type TransactionRunner = (
    updateFunction: (transaction: never) => Promise<unknown>
  ) => Promise<unknown>;
  const mutable = firestore as unknown as { runTransaction: TransactionRunner };
  const original = mutable.runTransaction.bind(mutable);
  mutable.runTransaction = async (updateFunction): Promise<unknown> => {
    await mutate();
    return await original(updateFunction);
  };
}

async function writeCleanupFixture(firestore: Firestore): Promise<void> {
  const targetContext = {
    version: 1 as const,
    status: 'finalized' as const,
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_target',
    userId: 'auth0:user_1',
    leaseFence: '7',
    scenarioContextCount: 0,
    finalizedAt: later,
  };
  const targetArtifactStageDigest = digestArtifactCandidates(
    '1'.repeat(64),
    '2'.repeat(64)
  );
  const targetTerminalCandidate = terminalCandidate({
    runId: 'run_target',
    outcome: 'completed_passed',
    projectionDigest: '3'.repeat(64),
    artifactStageRevision: 3,
    artifactCandidateDigest: targetArtifactStageDigest,
  });
  const targetScenarios = Array.from({ length: 20 }, (_, index) =>
    index === 0
      ? testRunScenario(1, {
          scenarioRevision: 1,
          eventWatermark: 1,
          lifecycle: 'completed',
          verdict: 'passed',
          completedTurns: 1,
          completedReplies: 1,
          deterministicVerdict: 'passed',
          semanticVerdict: 'passed',
          startedAt: later,
          finishedAt: later,
          durationMs: 1,
          sessionId: 'matrix_target_session',
          sessionBindingDigest: '9'.repeat(64),
        })
      : testRunScenario(index + 1)
  );
  await firestore.collection('intex_agent_test_runs').doc('run_current').set(
    testRunRecord({
      runId: 'run_current',
      leaseFence: '8',
      retentionReconciled: false,
    })
  );
  await firestore.collection('intex_agent_matrix_corpus_run_contexts').doc('run_current').set({
    ...activeRunContext(),
    runId: 'run_current',
    leaseFence: '8',
  });
  await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_current').set({
    ...emptyRunManifest(),
    runId: 'run_current',
    leaseFence: '8',
  });
  await firestore.collection('intex_agent_test_runs').doc('run_target').set(
    testRunRecord({
      runId: 'run_target',
      revision: 5,
      lifecycle: 'completed',
      verdict: 'passed',
      finishedAt: later,
      artifactDelivery: { status: 'ready', failureCode: null, updatedAt: later },
      contextFinalizationTombstoneDigest:
        FirestoreTestRunRepository.digestContextFinalization(targetContext),
      artifactStageDigest: targetArtifactStageDigest,
      terminalCandidate: targetTerminalCandidate,
      terminalWinner: {
        kind: 'release',
        eventId: 'terminal_target',
        payloadDigest: 'f'.repeat(64),
        outcome: 'completed_passed',
        acknowledgedAt: later,
      },
      scenarios: targetScenarios,
    })
  );
  await firestore.collection('intex_agent_test_runs').doc('run_newer_success').set(
    testRunRecord({
      runId: 'run_newer_success',
      leaseFence: '9',
      revision: 5,
      lifecycle: 'completed',
      verdict: 'passed',
      startedAt: '2026-07-20T10:04:00.000Z',
      updatedAt: later,
      finishedAt: later,
      artifactDelivery: { status: 'ready', failureCode: null, updatedAt: later },
      terminalWinner: {
        kind: 'release',
        eventId: 'terminal_newer_success',
        payloadDigest: 'e'.repeat(64),
        outcome: 'completed_passed',
        acknowledgedAt: later,
      },
    })
  );
  await firestore
    .collection('intex_agent_matrix_corpus_run_contexts')
    .doc('run_target')
    .set(targetContext);
  await firestore.collection('intex_agent_matrix_corpus_run_manifests').doc('run_target').set({
    version: 1,
    runtimeAudience: 'hetzner-prod',
    runId: 'run_target',
    userId: 'auth0:user_1',
    leaseFence: '7',
    catalogDigest: 'a'.repeat(64),
    scenarioBindings: [
      {
        scenarioId: 'scenario_001',
        scenarioNumber: 1,
        scenarioLabel: 'Scenario 001/020',
        sessionId: 'matrix_target_session',
      },
    ],
    artifactStage: {
      revision: 3,
      jsonCandidateDigest: '1'.repeat(64),
      markdownCandidateDigest: '2'.repeat(64),
      compositeDigest: targetArtifactStageDigest,
      stagedAt: later,
    },
    terminalCandidate: targetTerminalCandidate,
    createdAt: later,
  });
  const mockProfile = {
    version: 1 as const,
    calls: [],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution' as const,
  };
  await firestore.collection('intex_agent_sessions').doc('matrix_target_session').set({
    id: 'matrix_target_session',
    userId: 'auth0:user_1',
    channel: 'whatsapp',
    status: 'completed',
    startedAt: later,
    endedAt: later,
    lastUserMessageAt: later,
    lastAssistantMessageAt: later,
    startReason: 'no_active_session',
    endReason: 'tool_completed',
    matrixCorpusProfile: {
      version: 1,
      kind: 'matrix_corpus',
      runtimeAudience: 'hetzner-prod',
      leaseFence: '7',
      runId: 'run_target',
      scenarioId: 'scenario_001',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario 001/020',
      executionMode: 'strict_mock_tools',
      agentModel: 'or:deepseek/deepseek-v4-flash',
      evaluatorModel: 'or:minimax/minimax-m3',
      promptPreferencesVersion: 2,
      promptPreferencesDigest: 'b'.repeat(64),
      userTimeZone: 'Europe/Warsaw',
      mockProfile,
      mockProfileDigest: createHash('sha256')
        .update(canonicalMatrixCorpusStrictToolMockProfileV1(mockProfile), 'utf8')
        .digest('hex'),
      expectedToolSchedule: [],
    },
    lastEventSequence: 1,
  });
  await firestore.collection('intex_agent_session_events').doc('target_event_1').set({
    id: 'target_event_1',
    sessionId: 'matrix_target_session',
    userId: 'auth0:user_1',
    type: 'user_message',
    payload: { text: 'private target message', turnIndex: 0 },
    createdAt: later,
    eventSequence: 1,
  });
  await writeTestConfirmation(firestore, {
    confirmationId: 'target_confirmation_1',
    runId: 'run_target',
    scenarioId: 'scenario_001',
    sessionId: 'matrix_target_session',
    userId: 'auth0:user_1',
    leaseFence: '7',
  });
  await firestore
    .collection('intex_agent_matrix_corpus_ingest_receipts')
    .doc('target_ingest_1')
    .set({
      runId: 'run_target',
      scenarioId: 'scenario_001',
      sessionId: 'matrix_target_session',
      leaseFence: '7',
    });
  const projection = scenarioProjectionCommand().scenario?.projection;
  if (projection === undefined) throw new Error('cleanup projection fixture missing');
  const projectionId = createHash('sha256')
    .update('v1\u0000run_target\u0000scenario_001', 'utf8')
    .digest('hex');
  await firestore.collection('intex_agent_test_run_scenarios').doc(`v1_${projectionId}`).set({
    ...projection,
    runId: 'run_target',
    sessionId: 'matrix_target_session',
    runRevision: 5,
    lifecycle: 'completed',
    verdict: 'passed',
    completedTurns: 1,
  });
  await firestore.collection('intex_agent_sessions').doc('ordinary_session').set({
    id: 'ordinary_session',
    userId: 'auth0:user_1',
    channel: 'whatsapp',
    status: 'completed',
    startedAt: later,
    endedAt: later,
    lastUserMessageAt: later,
    startReason: 'no_active_session',
  });
}
