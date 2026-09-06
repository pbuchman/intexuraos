/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test fixtures preserve inferred literal result types. */
import Fastify, { type FastifyInstance } from 'fastify';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import type { Logger } from '@intexuraos/common-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MatrixCorpusControlPlane } from '../../domain/matrixCorpus/controlPlane.js';
import { MatrixCorpusRouteControlPlaneAdapter } from '../../domain/matrixCorpus/routeControlPlane.js';
import type { MatrixCorpusRepository } from '../../domain/matrixCorpus/ports/matrixCorpusRepository.js';
import type { IntexAgentMatrixCorpusClient } from '../../domain/matrixCorpus/ports/intexAgentMatrixCorpusClient.js';
import { createMatrixCorpusRoutes } from '../../routes/matrixCorpusRoutes.js';

const token = 'matrix-corpus-composition-auth';
const bindingA = 'a'.repeat(64);
const bindingB = 'b'.repeat(64);
const bindingC = 'c'.repeat(64);
const tombstoneDigest = 'd'.repeat(64);
const candidateDigest = 'e'.repeat(64);
const artifactDigest = 'f'.repeat(64);

function unexpectedMutation(): never {
  throw new Error('Unexpected repository method');
}

function repository(releaseRun: MatrixCorpusRepository['releaseRun']): MatrixCorpusRepository {
  return {
    acquireProvisioningLease: vi.fn(unexpectedMutation),
    activateRun: vi.fn(unexpectedMutation),
    renewLease: vi.fn(unexpectedMutation),
    issueCapability: vi.fn(unexpectedMutation),
    recordMatrixSendProof: vi.fn(unexpectedMutation),
    consumeCapabilityAndEnqueueIngest: vi.fn(unexpectedMutation),
    quiesceRun: vi.fn(unexpectedMutation),
    releaseRun,
    abandonExpiredRun: vi.fn(unexpectedMutation),
    getTransportStatus: vi.fn(unexpectedMutation),
    cleanupExactRun: vi.fn(unexpectedMutation),
    claimPendingIngestOutbox: vi.fn(unexpectedMutation),
    renewIngestOutboxClaim: vi.fn(unexpectedMutation),
    acknowledgeIngestOutbox: vi.fn(unexpectedMutation),
    claimPendingTerminalControlOutbox: vi.fn(unexpectedMutation),
    renewTerminalControlOutboxClaim: vi.fn(unexpectedMutation),
    acknowledgeTerminalControl: vi.fn(unexpectedMutation),
  };
}

describe('Matrix corpus route/control-plane composition', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  it('derives release proof server-side and reaches the real control plane without input corruption', async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = token;
    const releaseRun = vi
      .fn<MatrixCorpusRepository['releaseRun']>()
      .mockResolvedValue({ code: 'NOT_READY', gate: 'release' });
    const persistence = repository(releaseRun);
    const status = {
      kind: 'status',
      runId: 'run_1',
      userId: 'configured_user',
      leaseFence: '7',
      lifecycle: 'finalizing',
      contextReady: true,
      manifestReady: true,
      preflightProjectionReady: true,
      retentionReconciled: true,
      contextFinalizationTombstoneDigest: tombstoneDigest,
      terminalCandidateDigest: candidateDigest,
      artifactStageDigest: artifactDigest,
    } as const;
    const intexAgent: IntexAgentMatrixCorpusClient = {
      getTurnTerminal: vi.fn().mockResolvedValue({ kind: 'not_ready' }),
      getCurrentAcceptance: vi.fn().mockResolvedValue({ kind: 'not_ready' }),
      getControlStatus: vi.fn().mockResolvedValue(status),
      postTerminalControl: vi.fn().mockResolvedValue({ kind: 'not_ready' }),
    };
    const controlPlane = new MatrixCorpusControlPlane({
      repository: persistence,
      clock: { now: () => '2026-07-20T10:00:00.000Z' },
      digests: { digest: () => bindingA },
      sha256: { digestCanonical: () => bindingB },
      ids: { ingestReceiptId: () => 'receipt_1', ingestOutboxId: () => 'outbox_1' },
      intexAgent,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as unknown as Logger,
      leaseTtlMs: 300_000,
      capabilityTtlMs: 300_000,
    });
    const authorizeCurrentLeaseBinding = vi.fn().mockResolvedValue({ code: 'AUTHORIZED' });
    const routeControlPlane = new MatrixCorpusRouteControlPlaneAdapter({
      controlPlane,
      leaseBindingAuthorization: { authorizeCurrentLeaseBinding },
      cleanup: { cleanupExactRun: vi.fn(unexpectedMutation) },
      intexAgent,
    });

    app = Fastify({ logger: false });
    await app.register(intexuraFastifyPlugin);
    await app.register(
      createMatrixCorpusRoutes({
        gate: {
          enabled: true,
          runtimeAudience: 'hetzner-prod',
          evaluator: {
            userId: 'configured_user',
            matrixRoomBindingDigest: bindingA,
            whatsappAccountBindingDigest: bindingB,
            whatsappSenderBindingDigest: bindingC,
          },
        },
        digestMatrixIdempotencyKey: () => bindingA,
        issueControlAuthorization: vi.fn().mockResolvedValue({ code: 'NOT_READY' }),
        controlPlane: routeControlPlane,
      })
    );
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/matrix-corpus/runs/run_1/release',
      headers: { 'x-internal-auth': token },
      payload: { leaseFence: '7', idempotencyKey: 'release_00000001' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().data).toEqual({ code: 'NOT_READY' });
    expect(authorizeCurrentLeaseBinding).toHaveBeenCalledWith({
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'configured_user',
      leaseFence: '7',
      matrixRoomBindingDigest: bindingA,
      whatsappAccountBindingDigest: bindingB,
      whatsappSenderBindingDigest: bindingC,
    });
    expect(releaseRun).toHaveBeenCalledTimes(1);
    expect(releaseRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run_1',
        userId: 'configured_user',
        leaseFence: '7',
        controlStatus: status,
        terminalControl: expect.objectContaining({
          tombstoneDigest,
          terminalCandidateDigest: candidateDigest,
          artifactStageDigest: artifactDigest,
        }),
      })
    );
  });
});
