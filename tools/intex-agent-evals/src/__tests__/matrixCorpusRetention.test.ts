import { describe, expect, it, vi } from 'vitest';
import {
  cleanupEvictedMatrixCorpusRuns,
  selectMatrixCorpusRetention,
  type MatrixCorpusRetentionRecord,
} from '../matrixCorpus/reportArtifacts.js';
import {
  matrixCorpusKeyedDigest,
  reconcileMatrixCorpusRetention,
  type MatrixCorpusRetentionSaga,
  type MatrixCorpusRetentionSagaPort,
} from '../matrixCorpus/retentionExecution.js';

function sagaPort(
  initial: readonly MatrixCorpusRetentionSaga[] = []
): MatrixCorpusRetentionSagaPort & { readonly values: Map<string, MatrixCorpusRetentionSaga> } {
  const values = new Map(initial.map((saga) => [saga.targetRunId, saga]));
  return {
    values,
    load: vi.fn(async () => ({ ok: true as const, sagas: [...values.values()] })),
    save: vi.fn(async (saga: MatrixCorpusRetentionSaga) => {
      values.set(saga.targetRunId, structuredClone(saga));
      return true;
    }),
    remove: vi.fn(async (targetRunId: string) => {
      values.delete(targetRunId);
      return true;
    }),
  };
}

function record(
  runId: string,
  input: Partial<MatrixCorpusRetentionRecord> = {}
): MatrixCorpusRetentionRecord {
  return {
    runId,
    leaseFence: `${runId.length}`,
    startedAt: `2026-07-${String(runId.length).padStart(2, '0')}T00:00:00.000Z`,
    lifecycle: 'completed',
    verdict: 'passed',
    artifactDelivery: 'ready',
    completedAt: `2026-07-${String(runId.length).padStart(2, '0')}T00:00:00.000Z`,
    isCurrent: false,
    ...input,
  };
}

describe('matrix corpus exact-ID retention', () => {
  it('uses the same length-framed keyed run-fence digest as the WhatsApp owner', () => {
    expect(
      matrixCorpusKeyedDigest('h'.repeat(32), 'imc-run-fence-v1', [
        'hetzner-prod',
        'user_1',
        'run_old',
      ])
    ).toBe('b43c05bdbee55b90ed94218060830437b6c899b862d5ef2e4b4434993d5e71db');
  });

  it('retains a nonterminal/pending current acceptance plus latest ready pass and latest failure', () => {
    const records = [
      record('run_current', {
        lifecycle: 'running',
        verdict: 'pending',
        artifactDelivery: 'pending',
        completedAt: null,
        isCurrent: true,
      }),
      record('run_pass_old'),
      record('run_pass_latest', {
        startedAt: '2026-07-19T00:00:00.000Z',
        completedAt: '2026-07-19T00:00:00.000Z',
      }),
      record('run_fail_old', {
        startedAt: '2026-07-17T00:00:00.000Z',
        verdict: 'failed',
        completedAt: '2026-07-17T00:00:00.000Z',
      }),
      record('run_fail_latest', {
        startedAt: '2026-07-20T00:00:00.000Z',
        verdict: 'failed',
        artifactDelivery: 'failed',
        completedAt: '2026-07-20T00:00:00.000Z',
      }),
    ];
    const selection = selectMatrixCorpusRetention(records);
    expect(selection.retainRunIds).toEqual(['run_current', 'run_pass_latest']);
    expect(selection.evict.map((entry) => entry.runId).sort()).toEqual([
      'run_fail_latest',
      'run_fail_old',
      'run_pass_old',
    ]);
  });

  it('prefers the current failed acceptance over an older failure', () => {
    const selection = selectMatrixCorpusRetention([
      record('run_failed_current', {
        isCurrent: true,
        verdict: 'failed',
        artifactDelivery: 'unknown',
      }),
      record('run_failed_latest', {
        startedAt: '2026-07-20T00:00:00.000Z',
        verdict: 'failed',
        completedAt: '2026-07-20T00:00:00.000Z',
      }),
      record('run_pass', {
        startedAt: '2026-07-19T00:00:00.000Z',
        completedAt: '2026-07-19T00:00:00.000Z',
      }),
    ]);
    expect(selection.retainRunIds).toEqual(['run_failed_current', 'run_pass']);
  });

  it('uses run ID as the deterministic tiebreaker for equal startedAt values', () => {
    const startedAt = '2026-07-20T12:00:00.000Z';
    const selection = selectMatrixCorpusRetention([
      record('run-a', { startedAt }),
      record('run-z', { startedAt }),
    ]);

    expect(selection.retainRunIds).toEqual(['run-z']);
    expect(selection.evict.map((entry) => entry.runId)).toEqual(['run-a']);
  });

  it('cleans only evicted exact run/fence pairs after the new provisioning fence exists', async () => {
    const ordinaryState = {
      sessions: ['ordinary-session'],
      preferences: { locale: 'pl' },
      account: { enabled: true },
    };
    const before = structuredClone(ordinaryState);
    const records = [
      record('run_pass_latest', {
        startedAt: '2026-07-20T00:00:00.000Z',
        completedAt: '2026-07-20T00:00:00.000Z',
      }),
      record('run_pass_evicted', {
        startedAt: '2026-07-18T00:00:00.000Z',
        completedAt: '2026-07-18T00:00:00.000Z',
      }),
    ];
    const cleanupWhatsApp = vi.fn(async (target: MatrixCorpusRetentionRecord) => ({
      ok: true,
      targetRunId: target.runId,
      targetLeaseFence: target.leaseFence,
    }));
    const cleanupIntex = vi.fn(async (target: MatrixCorpusRetentionRecord) => ({
      ok: true,
      runId: target.runId,
      leaseFence: target.leaseFence,
    }));
    await expect(
      cleanupEvictedMatrixCorpusRuns({
        provisioningRunId: 'run_new',
        provisioningLeaseFence: '99',
        beforeActivation: true,
        records,
        cleanupWhatsApp,
        cleanupIntex,
      })
    ).resolves.toEqual({ ok: true, removed: 1 });
    expect(cleanupWhatsApp).toHaveBeenCalledWith(records[1]);
    expect(cleanupIntex).toHaveBeenCalledWith(records[1]);
    expect(ordinaryState).toEqual(before);
  });

  it('fails before calling cleanup outside provisioning and on partial/identity-mismatched cleanup', async () => {
    const cleanupWhatsApp = vi.fn(async () => ({
      ok: true,
      targetRunId: 'other',
      targetLeaseFence: '7',
    }));
    const cleanupIntex = vi.fn(async () => ({ ok: true, runId: 'target', leaseFence: '7' }));
    const records = [
      record('latest'),
      record('target', {
        startedAt: '2026-07-01T00:00:00.000Z',
        completedAt: '2026-07-01T00:00:00.000Z',
      }),
    ];
    await expect(
      cleanupEvictedMatrixCorpusRuns({
        provisioningRunId: 'new',
        provisioningLeaseFence: '1',
        beforeActivation: false,
        records,
        cleanupWhatsApp,
        cleanupIntex,
      })
    ).resolves.toEqual({ ok: false, code: 'RETENTION_CLEANUP_FAILED' });
    expect(cleanupWhatsApp).not.toHaveBeenCalled();
    await expect(
      cleanupEvictedMatrixCorpusRuns({
        provisioningRunId: 'new',
        provisioningLeaseFence: '1',
        beforeActivation: true,
        records,
        cleanupWhatsApp,
        cleanupIntex,
      })
    ).resolves.toEqual({ ok: false, code: 'RETENTION_CLEANUP_FAILED' });
    expect(cleanupIntex).not.toHaveBeenCalled();
  });

  it('reconciles one exact eviction in WhatsApp chunks, Intex, then local artifacts', async () => {
    const order: string[] = [];
    const records = [
      record('run_current', {
        startedAt: '2026-07-20T10:00:00.000Z',
        lifecycle: 'preflight',
        verdict: 'pending',
        artifactDelivery: 'pending',
        completedAt: null,
        isCurrent: true,
      }),
      record('run_pass', { startedAt: '2026-07-20T09:00:00.000Z' }),
      record('run_old', { startedAt: '2026-07-20T08:00:00.000Z', verdict: 'failed' }),
    ];
    const cleanupWhatsApp = vi
      .fn()
      .mockImplementationOnce(async (input: { expectedRevision: number }) => {
        order.push(`whatsapp:${String(input.expectedRevision)}`);
        return {
          ok: true as const,
          value: {
            code: 'RUN_CLEANUP_PROGRESS' as const,
            targetRunId: 'run_old',
            targetLeaseFence: '7',
            targetRunFenceDigest:
              '22b22538b09eea002251e20cf58f70a33b282d62cad9e6abc15405c8e1eb5245',
            state: 'progress' as const,
            committedRevision: 1,
            remainingChildCount: 1,
            chunkCommittedAt: '2026-07-20T10:00:01.000Z',
          },
        };
      })
      .mockImplementationOnce(async (input: { expectedRevision: number }) => {
        order.push(`whatsapp:${String(input.expectedRevision)}`);
        return {
          ok: true as const,
          value: {
            code: 'RUN_CLEANED' as const,
            targetRunId: 'run_old',
            targetLeaseFence: '7',
            targetRunFenceDigest:
              '22b22538b09eea002251e20cf58f70a33b282d62cad9e6abc15405c8e1eb5245',
            state: 'cleaned' as const,
            finalRevision: 2,
            cleanedAt: '2026-07-20T10:00:02.000Z',
          },
        };
      });
    const cleanupIntex = vi.fn(async () => {
      order.push('intex');
      return {
        ok: true as const,
        value: {
          disposition: 'applied' as const,
          runId: 'run_current',
          userId: 'user_1',
          leaseFence: '11',
          currentRevision: 2,
          retentionReconciled: true as const,
          removed: {
            runs: 1,
            sessions: 20,
            events: 60,
            confirmations: 2,
            ingestReceipts: 60,
            scenarioProjections: 20,
            scenarioContexts: 20,
            runContexts: 1,
            manifests: 1,
          },
        },
      };
    });
    const removeExactPrivateDirectory = vi.fn(async () => {
      order.push('artifact');
      return 'removed' as const;
    });
    const result = await reconcileMatrixCorpusRetention({
      runId: 'run_current',
      userId: 'user_1',
      leaseFence: '11',
      currentRevision: 1,
      bindingHmacKey: 'h'.repeat(32),
      artifactRoot: '/private/artifacts',
      files: { removeExactPrivateDirectory },
      sagas: sagaPort(),
      intex: {
        getMatrixCorpusRetentionPlan: vi.fn(async () => ({
          ok: true as const,
          value: {
            kind: 'retention_plan' as const,
            runId: 'run_current',
            userId: 'user_1',
            leaseFence: '11',
            records,
          },
        })),
        cleanupMatrixCorpusRun: cleanupIntex,
      },
      whatsapp: { cleanupMatrixCorpusRun: cleanupWhatsApp },
      now: () => new Date('2026-07-20T10:00:03.000Z'),
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 2,
      stats: {
        status: 'passed',
        runs: {
          observation: 'complete',
          considered: 3,
          retained: 2,
          removed: 1,
          missing: 0,
          failed: 0,
        },
        capabilities: {
          observation: 'not_observed',
          considered: 0,
          retained: 0,
          removed: 0,
          missing: 0,
          failed: 0,
        },
        sessions: {
          observation: 'removals_only',
          considered: 0,
          retained: 0,
          removed: 20,
          missing: 0,
          failed: 0,
        },
        artifacts: {
          observation: 'complete',
          considered: 3,
          retained: 2,
          removed: 1,
          missing: 0,
          failed: 0,
        },
      },
    });
    expect(order).toEqual(['whatsapp:0', 'whatsapp:1', 'intex', 'artifact', 'artifact']);
    expect(cleanupWhatsApp).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expectedRevision: 0,
        targetRunId: 'run_old',
        targetLeaseFence: '7',
        targetRunFenceDigest: 'b43c05bdbee55b90ed94218060830437b6c899b862d5ef2e4b4434993d5e71db',
      })
    );
    expect(removeExactPrivateDirectory).toHaveBeenCalledWith('/private/artifacts/run_old');
    expect(removeExactPrivateDirectory).toHaveBeenCalledWith('/private/artifacts/.run_old.staging');
  });

  it('reconciles a bounded backlog through separately authorized exact-run cleanups', async () => {
    const firstPlan = [
      record('run_current', {
        startedAt: '2026-07-20T10:00:00.000Z',
        lifecycle: 'preflight',
        verdict: 'pending',
        artifactDelivery: 'pending',
        completedAt: null,
        isCurrent: true,
      }),
      record('run_pass', { startedAt: '2026-07-20T09:00:00.000Z' }),
      record('run_old_1', { startedAt: '2026-07-20T08:00:00.000Z', verdict: 'failed' }),
      record('run_old_2', { startedAt: '2026-07-20T07:00:00.000Z', verdict: 'failed' }),
    ];
    const getMatrixCorpusRetentionPlan = vi.fn(async () => ({
      ok: true as const,
      value: {
        kind: 'retention_plan' as const,
        runId: 'run_current',
        userId: 'user_1',
        leaseFence: '11',
        records: firstPlan,
      },
    }));
    const cleanupWhatsApp = vi.fn(
      async (input: {
        targetRunId: string;
        targetLeaseFence: string;
        targetRunFenceDigest: string;
        expectedRevision: number;
      }) => ({
        ok: true as const,
        value: {
          code: 'RUN_CLEANED' as const,
          targetRunId: input.targetRunId,
          targetLeaseFence: input.targetLeaseFence,
          targetRunFenceDigest: input.targetRunFenceDigest,
          state: 'cleaned' as const,
          finalRevision: input.expectedRevision + 1,
          cleanedAt: '2026-07-20T10:00:01.000Z',
        },
      })
    );
    let currentRevision = 1;
    const cleanupIntex = vi.fn(async (_input: { request: { targetRunId: string } }) => ({
      ok: true as const,
      value: {
        disposition: 'applied' as const,
        runId: 'run_current',
        userId: 'user_1',
        leaseFence: '11',
        currentRevision: ++currentRevision,
        retentionReconciled: true as const,
        removed: {
          runs: 1,
          sessions: 0,
          events: 0,
          confirmations: 0,
          ingestReceipts: 0,
          scenarioProjections: 0,
          scenarioContexts: 0,
          runContexts: 1,
          manifests: 1,
        },
      },
    }));
    const removeExactPrivateDirectory = vi.fn(async (_path: string) => 'removed' as const);
    const result = await reconcileMatrixCorpusRetention({
      runId: 'run_current',
      userId: 'user_1',
      leaseFence: '11',
      currentRevision: 1,
      bindingHmacKey: 'h'.repeat(32),
      artifactRoot: '/private/artifacts',
      files: { removeExactPrivateDirectory },
      sagas: sagaPort(),
      intex: {
        getMatrixCorpusRetentionPlan,
        cleanupMatrixCorpusRun: cleanupIntex,
      },
      whatsapp: { cleanupMatrixCorpusRun: cleanupWhatsApp },
      now: () => new Date('2026-07-20T10:00:00.000Z'),
    });
    expect(result).toMatchObject({
      ok: true,
      revision: 3,
      stats: {
        status: 'passed',
        runs: { considered: 4, retained: 2, removed: 2, failed: 0 },
        artifacts: { considered: 4, retained: 2, removed: 2, failed: 0 },
      },
    });
    expect(getMatrixCorpusRetentionPlan).toHaveBeenCalledTimes(1);
    expect(cleanupWhatsApp.mock.calls.map(([input]) => input.targetRunId)).toEqual([
      'run_old_1',
      'run_old_2',
    ]);
    expect(cleanupIntex.mock.calls.map(([input]) => input.request.targetRunId)).toEqual([
      'run_old_1',
      'run_old_2',
    ]);
    expect(removeExactPrivateDirectory.mock.calls.map(([path]) => path)).toEqual([
      '/private/artifacts/run_old_1',
      '/private/artifacts/.run_old_1.staging',
      '/private/artifacts/run_old_2',
      '/private/artifacts/.run_old_2.staging',
    ]);
  });

  it('fails closed before mutation when persisted cleanup work exceeds the receipt bound', async () => {
    const cleanupMatrixCorpusRun = vi.fn();
    const result = await reconcileMatrixCorpusRetention({
      runId: 'run_current',
      userId: 'user_1',
      leaseFence: '11',
      currentRevision: 1,
      bindingHmacKey: 'h'.repeat(32),
      artifactRoot: '/private/artifacts',
      files: { removeExactPrivateDirectory: vi.fn() },
      sagas: sagaPort(
        Array.from({ length: 4 }, (_, index) => ({
          version: 1 as const,
          targetRunId: `run_old_${String(index + 1)}`,
          targetLeaseFence: String(index + 1),
          targetRunFenceDigest: String(index + 1).repeat(64),
          stage: 'whatsapp_pending' as const,
          whatsappRevision: 0,
        }))
      ),
      intex: {
        getMatrixCorpusRetentionPlan: vi.fn(async () => ({
          ok: true as const,
          value: {
            kind: 'retention_plan' as const,
            runId: 'run_current',
            userId: 'user_1',
            leaseFence: '11',
            records: [
              record('run_current', {
                lifecycle: 'preflight',
                verdict: 'pending',
                artifactDelivery: 'pending',
                completedAt: null,
                isCurrent: true,
              }),
            ],
          },
        })),
        cleanupMatrixCorpusRun,
      },
      whatsapp: { cleanupMatrixCorpusRun },
      now: () => new Date('2026-07-20T10:00:00.000Z'),
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'retention_cleanup_failed',
      stats: {
        runs: { failed: 4 },
        artifacts: { failed: 4 },
      },
    });
    expect(cleanupMatrixCorpusRun).not.toHaveBeenCalled();
  });

  it('resumes an exact cleanup saga after WhatsApp succeeded and Intex failed', async () => {
    const records = [
      record('run_current', {
        startedAt: '2026-07-20T10:00:00.000Z',
        lifecycle: 'preflight',
        verdict: 'pending',
        artifactDelivery: 'pending',
        completedAt: null,
        isCurrent: true,
      }),
      record('run_pass', { startedAt: '2026-07-20T09:00:00.000Z' }),
      record('run_old', { startedAt: '2026-07-20T08:00:00.000Z', verdict: 'failed' }),
    ];
    const sagas = sagaPort();
    const whatsapp = vi.fn(async () => ({
      ok: true as const,
      value: {
        code: 'RUN_CLEANED' as const,
        targetRunId: 'run_old',
        targetLeaseFence: '7',
        targetRunFenceDigest: '22b22538b09eea002251e20cf58f70a33b282d62cad9e6abc15405c8e1eb5245',
        state: 'cleaned' as const,
        finalRevision: 1,
        cleanedAt: '2026-07-20T10:00:01.000Z',
      },
    }));
    const plan = vi.fn(async () => ({
      ok: true as const,
      value: {
        kind: 'retention_plan' as const,
        runId: 'run_current',
        userId: 'user_1',
        leaseFence: '11',
        records,
      },
    }));
    const first = await reconcileMatrixCorpusRetention({
      runId: 'run_current',
      userId: 'user_1',
      leaseFence: '11',
      currentRevision: 1,
      bindingHmacKey: 'h'.repeat(32),
      artifactRoot: '/private/artifacts',
      files: { removeExactPrivateDirectory: vi.fn() },
      sagas,
      intex: {
        getMatrixCorpusRetentionPlan: plan,
        cleanupMatrixCorpusRun: vi.fn(async () => ({
          ok: false as const,
          error: { code: 'unavailable' as const },
        })),
      },
      whatsapp: { cleanupMatrixCorpusRun: whatsapp },
      now: () => new Date('2026-07-20T10:00:02.000Z'),
    });
    expect(first.ok).toBe(false);
    expect(sagas.values.get('run_old')?.stage).toBe('intex_request_in_flight');

    const remove = vi.fn(async () => 'removed' as const);
    const second = await reconcileMatrixCorpusRetention({
      runId: 'run_current',
      userId: 'user_1',
      leaseFence: '11',
      currentRevision: 1,
      bindingHmacKey: 'h'.repeat(32),
      artifactRoot: '/private/artifacts',
      files: { removeExactPrivateDirectory: remove },
      sagas,
      intex: {
        getMatrixCorpusRetentionPlan: plan,
        cleanupMatrixCorpusRun: vi.fn(async () => ({
          ok: true as const,
          value: {
            disposition: 'applied' as const,
            runId: 'run_current',
            userId: 'user_1',
            leaseFence: '11',
            currentRevision: 2,
            retentionReconciled: true as const,
            removed: {
              runs: 1,
              sessions: 20,
              events: 60,
              confirmations: 1,
              ingestReceipts: 60,
              scenarioProjections: 20,
              scenarioContexts: 20,
              runContexts: 1,
              manifests: 1,
            },
          },
        })),
      },
      whatsapp: { cleanupMatrixCorpusRun: whatsapp },
      now: () => new Date('2026-07-20T10:00:03.000Z'),
    });
    expect(second.ok).toBe(true);
    expect(whatsapp).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('/private/artifacts/run_old');
    expect(remove).toHaveBeenCalledWith('/private/artifacts/.run_old.staging');
    expect(sagas.values.size).toBe(0);
  });
});
