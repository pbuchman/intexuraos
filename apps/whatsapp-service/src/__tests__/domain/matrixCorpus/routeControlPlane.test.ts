/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test fixtures preserve inferred mock types. */
import { describe, expect, it, vi } from 'vitest';

import { MatrixCorpusRouteControlPlaneAdapter } from '../../../domain/matrixCorpus/routeControlPlane.js';

const digest = (value: string): string => value.repeat(64);

const authority = {
  runtimeAudience: 'hetzner-prod' as const,
  runId: 'run_1',
  userId: 'user_1',
  leaseFence: '7',
  matrixRoomBindingDigest: digest('1'),
  whatsappAccountBindingDigest: digest('2'),
  whatsappSenderBindingDigest: digest('3'),
};

const operation = { ...authority, idempotencyKey: 'operation-key' };
const cleanupInput = {
  ...authority,
  targetRunId: 'run_0',
  targetLeaseFence: '6',
  targetRunFenceDigest: digest('4'),
  expectedRevision: 3,
  idempotencyKey: 'cleanup-key',
};

describe('MatrixCorpusRouteControlPlaneAdapter', () => {
  it('delegates unbound and authorized operations with only their intended authority', async () => {
    const fixture = createFixture();

    await fixture.adapter.acquireProvisioningLease({ marker: 'acquire' } as never);
    await fixture.adapter.issueCapability({ marker: 'issue' } as never);
    await fixture.adapter.activateRun(operation);
    await fixture.adapter.renewLease(operation);
    await fixture.adapter.recordMatrixSendProof({ ...operation, marker: 'proof' } as never);
    await fixture.adapter.getTransportStatus(authority);
    await fixture.adapter.quiesceRun(operation);
    await fixture.adapter.abortProvisioningRun(operation);
    await fixture.adapter.cleanupExactRun(cleanupInput);

    expect(fixture.controlPlane.acquireProvisioningLease).toHaveBeenCalledWith({
      marker: 'acquire',
    });
    expect(fixture.controlPlane.issueCapability).toHaveBeenCalledWith({ marker: 'issue' });
    expect(fixture.authorization.authorizeCurrentLeaseBinding).toHaveBeenCalledTimes(7);
    expect(fixture.authorization.authorizeCurrentLeaseBinding).toHaveBeenCalledWith(authority);
    expect(fixture.controlPlane.activateRun).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '7',
      idempotencyKey: 'operation-key',
    });
    expect(fixture.controlPlane.renewLease).toHaveBeenCalledWith(
      expect.not.objectContaining({ matrixRoomBindingDigest: expect.anything() })
    );
    expect(fixture.controlPlane.recordMatrixSendProof).toHaveBeenCalledWith(
      expect.objectContaining({ matrixRoomBindingDigest: digest('1'), marker: 'proof' })
    );
    expect(fixture.controlPlane.getTransportStatus).toHaveBeenCalledWith(
      expect.not.objectContaining({ whatsappAccountBindingDigest: expect.anything() })
    );
    expect(fixture.controlPlane.quiesceRun).toHaveBeenCalledOnce();
    expect(fixture.controlPlane.abortProvisioningRun).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      observedRunId: 'run_1',
      observedUserId: 'user_1',
      observedLeaseFence: '7',
    });
    expect(fixture.cleanup.cleanupExactRun).toHaveBeenCalledWith(cleanupInput);
  });

  it('fails every bound operation closed when lease binding authorization rejects it', async () => {
    const fixture = createFixture({ authorizationResult: { code: 'STALE_FENCE' } });
    const calls = [
      fixture.adapter.activateRun(operation),
      fixture.adapter.renewLease(operation),
      fixture.adapter.recordMatrixSendProof({ ...operation, marker: 'proof' } as never),
      fixture.adapter.getTransportStatus(authority),
      fixture.adapter.quiesceRun(operation),
      fixture.adapter.releaseRun(operation),
      fixture.adapter.abortProvisioningRun(operation),
      fixture.adapter.cleanupExactRun(cleanupInput),
    ];

    await expect(Promise.all(calls)).resolves.toEqual(
      Array.from({ length: calls.length }, () => ({ code: 'STALE_FENCE' }))
    );
    expect(fixture.controlPlane.activateRun).not.toHaveBeenCalled();
    expect(fixture.controlPlane.renewLease).not.toHaveBeenCalled();
    expect(fixture.controlPlane.recordMatrixSendProof).not.toHaveBeenCalled();
    expect(fixture.controlPlane.getTransportStatus).not.toHaveBeenCalled();
    expect(fixture.controlPlane.quiesceRun).not.toHaveBeenCalled();
    expect(fixture.controlPlane.releaseRun).not.toHaveBeenCalled();
    expect(fixture.controlPlane.abortProvisioningRun).not.toHaveBeenCalled();
    expect(fixture.cleanup.cleanupExactRun).not.toHaveBeenCalled();
    expect(fixture.intexAgent.getControlStatus).not.toHaveBeenCalled();
  });

  it('maps authorization dependency failures to a content-free corrupt-state result', async () => {
    const fixture = createFixture();
    fixture.authorization.authorizeCurrentLeaseBinding.mockRejectedValueOnce(
      new Error('private dependency failure')
    );

    await expect(fixture.adapter.activateRun(operation)).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'lease',
    });
  });

  it('releases only after exact finalizing status and all three durable digests', async () => {
    const fixture = createFixture();
    fixture.intexAgent.getControlStatus.mockResolvedValueOnce(validFinalizingStatus());

    await expect(fixture.adapter.releaseRun(operation)).resolves.toEqual({ marker: 'release' });
    expect(fixture.controlPlane.releaseRun).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '7',
      idempotencyKey: 'operation-key',
      contextFinalizationTombstoneDigest: digest('a'),
      terminalCandidateDigest: digest('b'),
      artifactStageDigest: digest('c'),
    });
  });

  it.each([
    ['dependency throw', new Error('private status failure')],
    ['malformed', { kind: 'status' }],
    ['not ready', { kind: 'not_ready' }],
    ['wrong run', { ...validFinalizingStatus(), runId: 'run_other' }],
    ['wrong user', { ...validFinalizingStatus(), userId: 'user_other' }],
    ['wrong fence', { ...validFinalizingStatus(), leaseFence: '8' }],
    ['wrong lifecycle', { ...validFinalizingStatus(), lifecycle: 'running' }],
    [
      'missing tombstone',
      { ...validFinalizingStatus(), contextFinalizationTombstoneDigest: null },
    ],
    ['missing terminal candidate', { ...validFinalizingStatus(), terminalCandidateDigest: null }],
    ['missing artifact stage', { ...validFinalizingStatus(), artifactStageDigest: null }],
  ] as const)('fails release closed for %s', async (_label, status) => {
    const fixture = createFixture();
    if (status instanceof Error) {
      fixture.intexAgent.getControlStatus.mockRejectedValueOnce(status);
    } else {
      fixture.intexAgent.getControlStatus.mockResolvedValueOnce(status);
    }

    await expect(fixture.adapter.releaseRun(operation)).resolves.toEqual({
      code: 'NOT_READY',
      gate: 'release',
    });
    expect(fixture.controlPlane.releaseRun).not.toHaveBeenCalled();
  });
});

function createFixture(input?: Readonly<{ authorizationResult?: Readonly<{ code: 'STALE_FENCE' }> }>) {
  const controlPlane = {
    acquireProvisioningLease: vi.fn().mockResolvedValue({ marker: 'acquire' }),
    activateRun: vi.fn().mockResolvedValue({ marker: 'activate' }),
    renewLease: vi.fn().mockResolvedValue({ marker: 'renew' }),
    issueCapability: vi.fn().mockResolvedValue({ marker: 'issue' }),
    recordMatrixSendProof: vi.fn().mockResolvedValue({ marker: 'proof' }),
    getTransportStatus: vi.fn().mockResolvedValue({ marker: 'status' }),
    quiesceRun: vi.fn().mockResolvedValue({ marker: 'quiesce' }),
    releaseRun: vi.fn().mockResolvedValue({ marker: 'release' }),
    abortProvisioningRun: vi.fn().mockResolvedValue({ marker: 'abort' }),
  };
  const authorization = {
    authorizeCurrentLeaseBinding: vi
      .fn()
      .mockResolvedValue(input?.authorizationResult ?? { code: 'AUTHORIZED' }),
  };
  const cleanup = { cleanupExactRun: vi.fn().mockResolvedValue({ marker: 'cleanup' }) };
  const intexAgent = {
    getControlStatus: vi.fn(),
  };
  return {
    controlPlane,
    authorization,
    cleanup,
    intexAgent,
    adapter: new MatrixCorpusRouteControlPlaneAdapter({
      controlPlane: controlPlane as never,
      leaseBindingAuthorization: authorization as never,
      cleanup: cleanup as never,
      intexAgent: intexAgent as never,
    }),
  };
}

function validFinalizingStatus() {
  return {
    kind: 'status' as const,
    runId: 'run_1',
    userId: 'user_1',
    leaseFence: '7',
    lifecycle: 'finalizing' as const,
    contextReady: true,
    manifestReady: true,
    preflightProjectionReady: true,
    retentionReconciled: true,
    contextFinalizationTombstoneDigest: digest('a'),
    terminalCandidateDigest: digest('b'),
    artifactStageDigest: digest('c'),
  };
}
