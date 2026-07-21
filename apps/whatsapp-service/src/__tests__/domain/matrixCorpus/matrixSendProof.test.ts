import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { MatrixCorpusControlPlane } from '../../../domain/matrixCorpus/controlPlane.js';
import type { MatrixCorpusRepository } from '../../../domain/matrixCorpus/ports/matrixCorpusRepository.js';
import type { MatrixCorpusControlDependencies } from '../../../domain/matrixCorpus/types.js';

const NOW = '2026-07-20T10:00:02.500Z';
const CAPABILITY = `imc1_${'A'.repeat(43)}`;
const ROOM_ID = '!room:home-dev';
const MESSAGE_TEXT = `new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · ${CAPABILITY}\n\nPrivate test`;

describe('Matrix corpus outbound send proof', () => {
  it('derives and persists only exact digests for the independently observed event', async () => {
    const recordMatrixSendProof = vi.fn(async (command) => ({
      code: 'MATRIX_SEND_PROOF_RECORDED' as const,
      runId: command.runId,
      leaseFence: command.leaseFence,
      scenarioId: command.scenarioId,
      phase: command.phase,
      turnIndex: command.turnIndex,
      recordedAt: command.now,
    }));
    const controlPlane = new MatrixCorpusControlPlane(
      dependencies({ recordMatrixSendProof } as unknown as MatrixCorpusRepository)
    );

    await expect(controlPlane.recordMatrixSendProof(validInput())).resolves.toMatchObject({
      code: 'MATRIX_SEND_PROOF_RECORDED',
      scenarioId: 'scenario_1',
    });
    expect(recordMatrixSendProof).toHaveBeenCalledWith(
      expect.objectContaining({
        matrixRoomBindingDigest: '7'.repeat(64),
        matrixIdempotencyKeyDigest: '4'.repeat(64),
        matrixEventIdDigest: '5'.repeat(64),
        capabilityDigest: '3'.repeat(64),
        promptDigest: createHash('sha256')
          .update(
            JSON.stringify({ version: 1, body: 'Private test', startNewSession: true }),
            'utf8'
          )
          .digest('hex'),
      })
    );
  });

  it.each([
    ['wrong room', { matrixRoomId: '!wrong:home-dev' }],
    ['wrong event', { matrixEventId: 'not-a-matrix-event' }],
    ['wrong visible scenario', { messageText: MESSAGE_TEXT.replace('001/020', '002/020') }],
  ] as const)('fails closed for %s', async (_label, override) => {
    const recordMatrixSendProof = vi.fn();
    const controlPlane = new MatrixCorpusControlPlane(
      dependencies({ recordMatrixSendProof } as unknown as MatrixCorpusRepository)
    );

    const result = await controlPlane.recordMatrixSendProof({ ...validInput(), ...override });

    expect(result.code).not.toBe('MATRIX_SEND_PROOF_RECORDED');
    expect(recordMatrixSendProof).not.toHaveBeenCalled();
  });

  it('fails closed for invalid clock, digest, hash, and repository projections', async () => {
    const repository = {
      recordMatrixSendProof: vi.fn(),
    } as unknown as MatrixCorpusRepository;
    const base = dependencies(repository);
    const dependencyVariants: MatrixCorpusControlDependencies[] = [
      { ...base, clock: { now: () => 'invalid' } },
      { ...base, digests: { digest: () => 'invalid' } },
      { ...base, sha256: { digestCanonical: () => 'invalid' } },
    ];
    for (const variant of dependencyVariants) {
      const result = await new MatrixCorpusControlPlane(variant).recordMatrixSendProof(validInput());
      expect(result).toMatchObject({ code: 'CORRUPT_STATE', recordKind: 'command' });
    }
    expect(repository.recordMatrixSendProof).not.toHaveBeenCalled();

    for (const repositoryResult of [
      { unsafe: true },
      {
        code: 'MATRIX_SEND_PROOF_RECORDED',
        runId: 'run_other',
        leaseFence: '7',
        scenarioId: 'scenario_1',
        phase: 'start',
        turnIndex: 0,
        recordedAt: NOW,
      },
      {
        code: 'ALREADY_APPLIED',
        operation: 'record_matrix_send_proof',
        runId: 'run_other',
        leaseFence: '7',
        scenarioId: 'scenario_1',
        phase: 'start',
        turnIndex: 0,
        recordedAt: NOW,
      },
    ]) {
      const corruptRepository = {
        recordMatrixSendProof: vi.fn().mockResolvedValue(repositoryResult),
      } as unknown as MatrixCorpusRepository;
      await expect(
        new MatrixCorpusControlPlane(dependencies(corruptRepository)).recordMatrixSendProof(
          validInput()
        )
      ).resolves.toMatchObject({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    }
  });

  it('accepts an exactly correlated stored proof replay', async () => {
    const repository = {
      recordMatrixSendProof: vi.fn().mockResolvedValue({
        code: 'ALREADY_APPLIED',
        operation: 'record_matrix_send_proof',
        runId: 'run_1',
        leaseFence: '7',
        scenarioId: 'scenario_1',
        phase: 'start',
        turnIndex: 0,
        recordedAt: NOW,
      }),
    } as unknown as MatrixCorpusRepository;
    await expect(
      new MatrixCorpusControlPlane(dependencies(repository)).recordMatrixSendProof(validInput())
    ).resolves.toMatchObject({ code: 'ALREADY_APPLIED' });
  });
});

function validInput(): Parameters<MatrixCorpusControlPlane['recordMatrixSendProof']>[0] {
  return {
    runtimeAudience: 'home-dev' as const,
    runId: 'run_1',
    userId: 'configured_user',
    leaseFence: '7',
    matrixRoomBindingDigest: '7'.repeat(64),
    whatsappAccountBindingDigest: '8'.repeat(64),
    whatsappSenderBindingDigest: '9'.repeat(64),
    idempotencyKey: 'matrix-send-key-0001',
    rawCapability: CAPABILITY,
    scenarioId: 'scenario_1',
    scenarioNumber: 1,
    phase: 'start' as const,
    turnIndex: 0,
    matrixEventId: '$event-1',
    matrixRoomId: ROOM_ID,
    messageText: MESSAGE_TEXT,
  };
}

function dependencies(repository: MatrixCorpusRepository): MatrixCorpusControlDependencies {
  return {
    repository,
    clock: { now: () => NOW },
    digests: {
      digest(domain, parts): string {
        if (domain === 'imc-lease-slot-v1' && parts[0] === 'matrix-room-binding') {
          return parts[1] === ROOM_ID ? '7'.repeat(64) : '6'.repeat(64);
        }
        if (domain === 'imc-capability-v1') return '3'.repeat(64);
        if (domain === 'imc-matrix-idempotency-v1') return '4'.repeat(64);
        if (domain === 'imc-matrix-event-v1') return '5'.repeat(64);
        if (domain === 'imc-run-fence-v1') return '2'.repeat(64);
        return '1'.repeat(64);
      },
    },
    sha256: {
      digestCanonical: (canonicalJson) =>
        createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
    },
    ids: { ingestReceiptId: () => 'receipt_1', ingestOutboxId: () => 'outbox_1' },
    intexAgent: {} as MatrixCorpusControlDependencies['intexAgent'],
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    leaseTtlMs: 300_000,
    capabilityTtlMs: 300_000,
  };
}
