import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { describe, expect, it } from 'vitest';

import {
  FirestoreMatrixCorpusManifestRepository,
  INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION,
  parseMatrixCorpusRunManifestDocument,
} from '../../../infra/firestore/matrixCorpusManifestRepository.js';
import { digestArtifactCandidates } from '../../../domain/testRuns/stateMachine.js';
import type {
  MatrixCorpusRunManifestScenarioBindingV1,
  MatrixCorpusRunManifestV1,
} from '../../../domain/matrixCorpus/ports/matrixCorpusManifestRepository.js';

const createdAt = '2026-07-20T10:00:00.000Z';

function manifest(
  overrides: Readonly<Record<string, unknown>> = {}
): MatrixCorpusRunManifestV1 {
  return {
    version: 1 as const,
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'auth0:user_1',
    leaseFence: '7',
    catalogDigest: 'a'.repeat(64),
    scenarioBindings: [],
    artifactStage: null,
    terminalCandidate: null,
    createdAt,
    ...overrides,
  } as MatrixCorpusRunManifestV1;
}

function binding(
  scenarioNumber: number,
  overrides: Readonly<Record<string, unknown>> = {}
): MatrixCorpusRunManifestScenarioBindingV1 {
  return {
    scenarioId: `scenario_${String(scenarioNumber).padStart(3, '0')}`,
    scenarioNumber,
    scenarioLabel: `Natural catalog label ${String(scenarioNumber)}`,
    sessionId: `session_${String(scenarioNumber)}`,
    ...overrides,
  } as MatrixCorpusRunManifestScenarioBindingV1;
}

function fixture(): Readonly<{
  firestore: Firestore;
  repository: FirestoreMatrixCorpusManifestRepository;
}> {
  const firestore = createFakeFirestore() as unknown as Firestore;
  return {
    firestore,
    repository: new FirestoreMatrixCorpusManifestRepository({ firestore }),
  };
}

describe('FirestoreMatrixCorpusManifestRepository', () => {
  it('creates one closed immutable run manifest without private context', async () => {
    const { firestore, repository } = fixture();

    await expect(repository.createOrGet(manifest())).resolves.toEqual({
      ok: true,
      disposition: 'applied',
      manifest: manifest(),
    });
    const stored = await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc('run_1')
      .get();
    expect(stored.data()).toEqual(manifest());
    for (const forbidden of [
      'promptContext',
      'encryptedPromptContext',
      'capability',
      'attestation',
      'message',
      'mockProfile',
    ])
      expect(stored.data()).not.toHaveProperty(forbidden);
  });

  it('returns the first manifest for exact sequential and concurrent registration replay', async () => {
    const { repository } = fixture();
    const first = repository.createOrGet(manifest());
    const second = repository.createOrGet(manifest({ createdAt: '2026-07-20T10:00:01.000Z' }));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({ ok: true, disposition: 'applied' });
    expect(secondResult).toMatchObject({
      ok: true,
      disposition: 'already_applied',
      manifest: { createdAt },
    });
    await expect(repository.createOrGet(manifest())).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
    });
  });

  it('rejects changed ownership, fence, or catalog without mutating the first manifest', async () => {
    const { repository } = fixture();
    await repository.createOrGet(manifest());

    for (const changed of [
      manifest({ userId: 'auth0:user_2' }),
      manifest({ leaseFence: '8' }),
      manifest({ catalogDigest: 'b'.repeat(64) }),
      manifest({ runtimeAudience: 'prod' }),
    ])
      await expect(repository.createOrGet(changed as never)).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });

    await expect(
      repository.getExact({ runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' })
    ).resolves.toMatchObject({ ok: true, manifest: manifest() });
  });

  it('appends ordered unique scenario/session bindings and replays exact writes', async () => {
    const { repository } = fixture();
    await repository.createOrGet(manifest());

    const first = repository.appendScenarioBinding({
      identity: { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' },
      binding: binding(1),
    });
    const duplicate = repository.appendScenarioBinding({
      identity: { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' },
      binding: binding(1),
    });
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);

    expect(firstResult).toMatchObject({ ok: true, disposition: 'applied' });
    expect(duplicateResult).toMatchObject({ ok: true, disposition: 'already_applied' });
    await expect(
      repository.appendScenarioBinding({
        identity: { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' },
        binding: binding(2),
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      manifest: { scenarioBindings: [binding(1), binding(2)] },
    });
  });

  it('rejects changed scenario reuse, duplicate number/session, gaps, and more than 20 bindings', async () => {
    const { repository } = fixture();
    await repository.createOrGet(manifest());
    const identity = { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' };
    await repository.appendScenarioBinding({ identity, binding: binding(1) });

    for (const invalid of [
      binding(1, { sessionId: 'session_changed' }),
      binding(2, { scenarioId: 'scenario_changed', scenarioNumber: 1 }),
      binding(2, { sessionId: 'session_1' }),
      binding(2, { scenarioLabel: '' }),
      binding(3),
    ])
      await expect(
        repository.appendScenarioBinding({ identity, binding: invalid as never })
      ).resolves.toEqual({ ok: false, code: 'BINDING_CONFLICT' });

    for (let scenarioNumber = 2; scenarioNumber <= 20; scenarioNumber += 1)
      await repository.appendScenarioBinding({ identity, binding: binding(scenarioNumber) });
    await expect(
      repository.appendScenarioBinding({ identity, binding: binding(21) as never })
    ).resolves.toEqual({ ok: false, code: 'BINDING_LIMIT_EXCEEDED' });
  });

  it('fails closed for missing, mismatched, or corrupt manifests and defensively clones results', async () => {
    const { firestore, repository } = fixture();
    const identity = { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' };
    await expect(repository.getExact(identity)).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    const created = await repository.createOrGet(manifest());
    if (!created.ok) throw new Error('fixture create failed');
    created.manifest.catalogDigest = 'b'.repeat(64);
    await expect(repository.getExact({ ...identity, leaseFence: '8' })).resolves.toEqual({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    await expect(repository.getExact(identity)).resolves.toMatchObject({
      ok: true,
      manifest: { catalogDigest: 'a'.repeat(64) },
    });

    await firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc('run_1')
      .set({ ...manifest(), extra: 'unsafe' });
    await expect(repository.getExact(identity)).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_MANIFEST',
    });
  });

  it('fails closed for invalid create, append, and read dependencies', async () => {
    const identity = { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' };
    await expect(fixture().repository.createOrGet(manifest({ runId: '' }))).resolves.toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    await expect(
      fixture().repository.createOrGet(manifest({ scenarioBindings: [binding(1)] }))
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });

    const corruptCreate = fixture();
    await corruptCreate.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc('run_1')
      .set({ corrupt: true });
    await expect(corruptCreate.repository.createOrGet(manifest())).resolves.toEqual({
      ok: false,
      code: 'CORRUPT_MANIFEST',
    });

    await expect(
      fixture().repository.appendScenarioBinding({ identity, binding: binding(1) })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    await expect(
      fixture().repository.appendScenarioBinding({
        identity: { ...identity, runId: '' },
        binding: binding(1),
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });

    const corruptAppend = fixture();
    await corruptAppend.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc('run_1')
      .set({ corrupt: true });
    await expect(
      corruptAppend.repository.appendScenarioBinding({ identity, binding: binding(1) })
    ).resolves.toEqual({ ok: false, code: 'CORRUPT_MANIFEST' });

    const foreignAppend = fixture();
    await foreignAppend.repository.createOrGet(manifest());
    await expect(
      foreignAppend.repository.appendScenarioBinding({
        identity: { ...identity, leaseFence: '8' },
        binding: binding(1),
      })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });

    await expect(
      fixture().repository.getExact({ ...identity, runId: '' })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('clones non-null artifact and terminal state and prevents later scenario appends', async () => {
    const jsonCandidateDigest = '1'.repeat(64);
    const markdownCandidateDigest = '2'.repeat(64);
    const compositeDigest = digestArtifactCandidates(
      jsonCandidateDigest,
      markdownCandidateDigest
    );
    const staged = manifest({
      artifactStage: {
        revision: 2,
        jsonCandidateDigest,
        markdownCandidateDigest,
        compositeDigest,
        stagedAt: createdAt,
      },
      terminalCandidate: {
        version: 1,
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        outcome: 'stopped_not_evaluated',
        projectionDigest: '3'.repeat(64),
        artifactStageRevision: 2,
        artifactCandidateDigest: compositeDigest,
        createdAt,
      },
    });
    const { repository } = fixture();
    const created = await repository.createOrGet(staged);
    expect(created).toMatchObject({ ok: true, manifest: staged });
    if (!created.ok || created.manifest.artifactStage === null) throw new Error('stage missing');
    created.manifest.artifactStage.revision = 9;

    await expect(
      repository.appendScenarioBinding({
        identity: { runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' },
        binding: binding(1),
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_STATE' });
    await expect(
      repository.getExact({ runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' })
    ).resolves.toMatchObject({
      ok: true,
      manifest: { artifactStage: { revision: 2 }, terminalCandidate: staged.terminalCandidate },
    });
  });

  it('accepts only an exact artifact stage and terminal candidate binding', () => {
    const jsonCandidateDigest = '1'.repeat(64);
    const markdownCandidateDigest = '2'.repeat(64);
    const compositeDigest = digestArtifactCandidates(
      jsonCandidateDigest,
      markdownCandidateDigest
    );
    const artifactStage = {
      revision: 2,
      jsonCandidateDigest,
      markdownCandidateDigest,
      compositeDigest,
      stagedAt: createdAt,
    };
    const terminalCandidate = {
      version: 1 as const,
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
      outcome: 'stopped_not_evaluated' as const,
      projectionDigest: '3'.repeat(64),
      artifactStageRevision: 2,
      artifactCandidateDigest: compositeDigest,
      createdAt,
    };
    const exact = manifest({ artifactStage, terminalCandidate });

    expect(parseMatrixCorpusRunManifestDocument(exact)).toEqual(exact);
    expect(
      parseMatrixCorpusRunManifestDocument({
        ...exact,
        artifactStage: { ...artifactStage, compositeDigest: '0'.repeat(64) },
      })
    ).toBeUndefined();
    expect(
      parseMatrixCorpusRunManifestDocument({
        ...exact,
        artifactStage: { ...artifactStage, extra: 'private' },
      })
    ).toBeUndefined();
    expect(
      parseMatrixCorpusRunManifestDocument({
        ...exact,
        terminalCandidate: { ...terminalCandidate, artifactStageRevision: 3 },
      })
    ).toBeUndefined();
    expect(
      parseMatrixCorpusRunManifestDocument({
        ...exact,
        terminalCandidate: {
          ...terminalCandidate,
          artifactCandidateDigest: '4'.repeat(64),
        },
      })
    ).toBeUndefined();
  });

  it('rejects every invalid manifest identity, binding, stage, candidate, and timestamp field', () => {
    for (const invalid of [
      null,
      [],
      { ...manifest(), version: 2 },
      { ...manifest(), runtimeAudience: 'production' },
      { ...manifest(), runId: '' },
      { ...manifest(), userId: '' },
      { ...manifest(), leaseFence: '0' },
      { ...manifest(), catalogDigest: 'invalid' },
      { ...manifest(), createdAt: 'invalid' },
      { ...manifest(), scenarioBindings: 'invalid' },
      { ...manifest(), scenarioBindings: [{ ...binding(1), extra: true }] },
      { ...manifest(), scenarioBindings: [binding(1, { scenarioId: '' })] },
      { ...manifest(), scenarioBindings: [binding(1, { sessionId: '' })] },
      { ...manifest(), scenarioBindings: [binding(1, { scenarioNumber: 1.5 })] },
      { ...manifest(), scenarioBindings: [binding(1, { scenarioNumber: 0 })] },
      { ...manifest(), scenarioBindings: [binding(1, { scenarioNumber: 21 })] },
      { ...manifest(), scenarioBindings: [binding(1, { scenarioLabel: '' })] },
      { ...manifest(), scenarioBindings: [binding(1, { scenarioLabel: 'x'.repeat(129) })] },
      { ...manifest(), scenarioBindings: [binding(1), binding(2, { scenarioId: 'scenario_001' })] },
      { ...manifest(), scenarioBindings: [binding(1), binding(2, { scenarioNumber: 1, scenarioLabel: 'Scenario 001/020' })] },
      { ...manifest(), scenarioBindings: [binding(1), binding(2, { sessionId: 'session_1' })] },
      { ...manifest(), artifactStage: { invalid: true } },
      { ...manifest(), terminalCandidate: { invalid: true } },
    ])
      expect(parseMatrixCorpusRunManifestDocument(invalid)).toBeUndefined();
  });
});
