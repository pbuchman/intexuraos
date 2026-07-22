/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test fixtures preserve inferred literal result types. */
import { createHash } from 'node:crypto';

import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { describe, expect, it, vi } from 'vitest';

import { createMatrixCorpusSha256 } from '../../../domain/matrixCorpus/crypto.js';
import {
  digestMatrixCorpusPromptV1,
  parseMatrixCorpusVisibleMessage,
} from '../../../domain/matrixCorpus/visibleHeader.js';
import { FirestoreMatrixCorpusIngress } from '../../../infra/firestore/matrixCorpusIngress.js';
import { MATRIX_CORPUS_CAPABILITIES_COLLECTION } from '../../../infra/firestore/matrixCorpusRepository.js';

const rawCapability = `imc1_${'A'.repeat(43)}`;
const capabilityDigest = '1'.repeat(64);
const transportDigest = '3'.repeat(64);
const timestamp = '2026-07-20T10:00:03.000Z';
const accountBindingDigest = '8'.repeat(64);
const senderBindingDigest = '9'.repeat(64);

describe('Firestore Matrix corpus ingress', () => {
  it('reconstructs one capability-bound private ingest and delegates transactional consumption', async () => {
    const fake = createFakeFirestore();
    fake.clear();
    fake.seedCollection(MATRIX_CORPUS_CAPABILITIES_COLLECTION, [
      { id: capabilityDigest, data: storedCapability() },
    ]);
    const consumeCapabilityAndEnqueueIngest = vi.fn(async (_input: unknown) => ({
      code: 'INGEST_ENQUEUED' as const,
      operation: 'consume' as const,
      result: 'enqueued' as const,
      runId: 'run_1',
      scenarioId: 'scenario_1',
      phase: 'start' as const,
      turnIndex: 0,
      ingestReceiptId: `imc_ingest_receipt_v1_${transportDigest}`,
      ingestOutboxId: `imc_ingest_outbox_v1_${transportDigest}`,
      acceptedAt: timestamp,
    }));
    const ingress = new FirestoreMatrixCorpusIngress({
      firestore: fake as unknown as Firestore,
      controlPlane: { consumeCapabilityAndEnqueueIngest } as never,
      digests: ingressDigests(),
      sha256: createMatrixCorpusSha256(),
      expectedMatrixRoomBindingDigest: '7'.repeat(64),
      expectedWhatsAppAccountBindingDigest: accountBindingDigest,
      expectedWhatsAppSenderBindingDigest: senderBindingDigest,
    });
    const message = parseMatrixCorpusVisibleMessage(
      `new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · ${rawCapability}\n\nhello`
    );
    if (message.kind !== 'matrix_corpus') throw new Error('fixture parse failed');

    await expect(
      ingress.consumeReservedMessage({
        message,
        userId: 'private_user_fixture',
        transportMessageId: 'wamid.fixture_1',
        webhookEventId: 'webhook_1',
        senderPhoneNumber: 'sender',
        recipientPhoneNumber: 'recipient',
        whatsappAccountId: 'account',
        timestamp,
      })
    ).resolves.toEqual({ code: 'INGEST_ENQUEUED' });

    expect(consumeCapabilityAndEnqueueIngest).toHaveBeenCalledTimes(1);
    const candidate = consumeCapabilityAndEnqueueIngest.mock.calls[0]?.[0];
    expect(candidate).toMatchObject({
      rawCapability,
      transportMessageId: 'wamid.fixture_1',
      facts: {
        payload: {
          ordinaryIngest: {
            text: 'new session: hello',
            userId: 'private_user_fixture',
          },
          context: {
            runId: 'run_1',
            scenarioId: 'scenario_1',
            startNewSession: true,
          },
        },
      },
    });
  });

  it('normalizes the Unix-seconds timestamp delivered by Meta before attesting the ingest', async () => {
    const current = ingressFixture(storedCapability());
    const metaTimestamp = '1784675542';

    await expect(
      current.ingress.consumeReservedMessage({
        ...startInput(),
        timestamp: metaTimestamp,
      })
    ).resolves.toEqual({ code: 'INGEST_ENQUEUED' });

    expect(current.consumeCapabilityAndEnqueueIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        facts: expect.objectContaining({
          ingressRequest: expect.objectContaining({
            ordinaryTimestamp: new Date(Number(metaTimestamp) * 1_000).toISOString(),
          }),
          payload: expect.objectContaining({
            ordinaryIngest: expect.objectContaining({
              timestamp: new Date(Number(metaTimestamp) * 1_000).toISOString(),
            }),
          }),
        }),
      })
    );
  });

  it.each([
    ['non-numeric transport timestamp', 'not-a-timestamp'],
    ['unsafe Unix-seconds integer', '9999999999999'],
    ['Unix-seconds timestamp outside the supported RFC3339 year range', '253402300800'],
  ])('fails closed before consumption for %s', async (_description, invalidTimestamp) => {
    const current = ingressFixture(storedCapability());

    await expect(
      current.ingress.consumeReservedMessage({
        ...startInput(),
        timestamp: invalidTimestamp,
      })
    ).resolves.toEqual({ code: 'NOT_READY' });

    expect(current.consumeCapabilityAndEnqueueIngest).not.toHaveBeenCalled();
  });

  it('fails closed before consumption for a prompt or identity mismatch', async () => {
    const fake = createFakeFirestore();
    fake.clear();
    fake.seedCollection(MATRIX_CORPUS_CAPABILITIES_COLLECTION, [
      { id: capabilityDigest, data: storedCapability() },
    ]);
    const consumeCapabilityAndEnqueueIngest = vi.fn();
    const ingress = new FirestoreMatrixCorpusIngress({
      firestore: fake as unknown as Firestore,
      controlPlane: { consumeCapabilityAndEnqueueIngest } as never,
      digests: ingressDigests(),
      sha256: createMatrixCorpusSha256(),
      expectedMatrixRoomBindingDigest: '7'.repeat(64),
      expectedWhatsAppAccountBindingDigest: accountBindingDigest,
      expectedWhatsAppSenderBindingDigest: senderBindingDigest,
    });
    const message = parseMatrixCorpusVisibleMessage(
      `new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · ${rawCapability}\n\nchanged`
    );
    if (message.kind !== 'matrix_corpus') throw new Error('fixture parse failed');

    await expect(
      ingress.consumeReservedMessage({
        message,
        userId: 'another_user',
        transportMessageId: 'wamid.fixture_2',
        webhookEventId: 'webhook_2',
        senderPhoneNumber: 'sender',
        recipientPhoneNumber: 'recipient',
        whatsappAccountId: 'account',
        timestamp,
      })
    ).resolves.toEqual({ code: 'CAPABILITY_MISMATCH' });
    expect(consumeCapabilityAndEnqueueIngest).not.toHaveBeenCalled();
  });

  it.each([
    { whatsappAccountId: 'another-account', senderPhoneNumber: 'sender' },
    { whatsappAccountId: 'account', senderPhoneNumber: 'another-sender' },
    { whatsappAccountId: null, senderPhoneNumber: 'sender' },
  ])(
    'fails closed when the observed WhatsApp transport binding is not the configured evaluator binding',
    async ({ whatsappAccountId, senderPhoneNumber }) => {
      const fake = createFakeFirestore();
      fake.clear();
      fake.seedCollection(MATRIX_CORPUS_CAPABILITIES_COLLECTION, [
        { id: capabilityDigest, data: storedCapability() },
      ]);
      const consumeCapabilityAndEnqueueIngest = vi.fn();
      const ingress = new FirestoreMatrixCorpusIngress({
        firestore: fake as unknown as Firestore,
        controlPlane: { consumeCapabilityAndEnqueueIngest } as never,
        digests: ingressDigests(),
        sha256: createMatrixCorpusSha256(),
        expectedMatrixRoomBindingDigest: '7'.repeat(64),
        expectedWhatsAppAccountBindingDigest: accountBindingDigest,
        expectedWhatsAppSenderBindingDigest: senderBindingDigest,
      });
      const message = parseMatrixCorpusVisibleMessage(
        `new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · ${rawCapability}\n\nhello`
      );
      if (message.kind !== 'matrix_corpus') throw new Error('fixture parse failed');

      await expect(
        ingress.consumeReservedMessage({
          message,
          userId: 'private_user_fixture',
          transportMessageId: 'wamid.fixture_3',
          webhookEventId: 'webhook_3',
          senderPhoneNumber,
          recipientPhoneNumber: 'recipient',
          whatsappAccountId,
          timestamp,
        })
      ).resolves.toEqual({ code: 'CAPABILITY_MISMATCH' });
      expect(consumeCapabilityAndEnqueueIngest).not.toHaveBeenCalled();
    }
  );

  it('fails closed when the capability is absent or corrupt', async () => {
    const absent = ingressFixture(null);
    await expect(absent.ingress.consumeReservedMessage(startInput())).resolves.toEqual({
      code: 'NOT_FOUND',
    });

    const corrupt = ingressFixture({ private: 'corrupt' });
    await expect(corrupt.ingress.consumeReservedMessage(startInput())).resolves.toEqual({
      code: 'NOT_READY',
    });
    expect(absent.consumeCapabilityAndEnqueueIngest).not.toHaveBeenCalled();
    expect(corrupt.consumeCapabilityAndEnqueueIngest).not.toHaveBeenCalled();
  });

  it.each([
    ['capability digest', { capabilityDigest: 'a'.repeat(64) }],
    ['user', { userId: 'another_user' }],
    ['scenario', { scenarioNumber: 2 }],
    [
      'phase',
      {
        phase: 'turn',
        turnIndex: 1,
        expectedSessionId: 'session_1',
      },
    ],
    ['configured room', { matrixRoomBindingDigest: '6'.repeat(64) }],
    ['configured account', { whatsappAccountBindingDigest: '6'.repeat(64) }],
    ['configured sender', { whatsappSenderBindingDigest: '6'.repeat(64) }],
    ['prompt', { promptDigest: '6'.repeat(64) }],
  ] as const)('fails closed for a stored %s mismatch', async (_label, override) => {
    const current = ingressFixture(storedCapability(override));

    await expect(current.ingress.consumeReservedMessage(startInput())).resolves.toEqual({
      code: 'CAPABILITY_MISMATCH',
    });
    expect(current.consumeCapabilityAndEnqueueIngest).not.toHaveBeenCalled();
  });

  it('reconstructs turn and confirmation facts and enforces the visible turn ordinal', async () => {
    const turnStored = storedCapability({
      phase: 'turn',
      turnIndex: 1,
      expectedSessionId: 'session_1',
      promptDigest: digestMatrixCorpusPromptV1({ body: 'turn body', startNewSession: false }),
    });
    const turn = ingressFixture(turnStored);
    const turnMessage = corpusMessage(
      `🧪 Scenario 001/020 · step 2/5 · ${rawCapability}\n\nturn body`
    );
    await expect(turn.ingress.consumeReservedMessage(inputFor(turnMessage))).resolves.toEqual({
      code: 'INGEST_ENQUEUED',
    });
    expect(turn.consumeCapabilityAndEnqueueIngest).toHaveBeenCalledWith(
      expect.objectContaining({ facts: expect.objectContaining({
        payload: expect.objectContaining({ context: expect.objectContaining({ phase: 'turn' }) }),
      }) })
    );

    const wrongOrdinal = ingressFixture(turnStored);
    const firstTurnMessage = corpusMessage(
      `🧪 Scenario 001/020 · step 1/5 · ${rawCapability}\n\nturn body`
    );
    await expect(
      wrongOrdinal.ingress.consumeReservedMessage(inputFor(firstTurnMessage))
    ).resolves.toEqual({ code: 'CAPABILITY_MISMATCH' });

    const confirmation = ingressFixture(
      storedCapability({
        phase: 'confirmation',
        turnIndex: 2,
        expectedSessionId: 'session_1',
        pendingConfirmationId: 'confirmation_1',
        expectedDecision: 'confirm',
        promptDigest: digestMatrixCorpusPromptV1({
          body: 'confirmation body',
          startNewSession: false,
        }),
      })
    );
    const confirmationMessage = corpusMessage(
      `🧪 Scenario 001/020 · confirmation · ${rawCapability}\n\nconfirmation body`
    );
    await expect(
      confirmation.ingress.consumeReservedMessage(inputFor(confirmationMessage))
    ).resolves.toEqual({ code: 'INGEST_ENQUEUED' });
  });

  it('maps unknown control-plane outcomes, unsafe ids, and dependency exceptions to not-ready', async () => {
    const unknown = ingressFixture(storedCapability(), 'PRIVATE_UNKNOWN');
    await expect(unknown.ingress.consumeReservedMessage(startInput())).resolves.toEqual({
      code: 'NOT_READY',
    });

    const unsafeIds = ingressFixture(storedCapability(), 'INGEST_ENQUEUED', {
      digest(domain: string, parts: readonly string[]) {
        if (domain === 'imc-transport-v1') return 'x'.repeat(300);
        return ingressDigests().digest(domain, parts);
      },
    });
    await expect(unsafeIds.ingress.consumeReservedMessage(startInput())).resolves.toEqual({
      code: 'NOT_READY',
    });

    const failure = ingressFixture(storedCapability());
    failure.consumeCapabilityAndEnqueueIngest.mockRejectedValueOnce(
      new Error('private dependency failure')
    );
    await expect(failure.ingress.consumeReservedMessage(startInput())).resolves.toEqual({
      code: 'NOT_READY',
    });
  });
});

function ingressDigests() {
  return {
    digest(domain: string, parts: readonly string[]) {
      if (domain === 'imc-capability-v1') return capabilityDigest;
      if (domain === 'imc-transport-v1') return transportDigest;
      if (parts[0] === 'whatsapp-account-binding' && parts[1] === 'account')
        return accountBindingDigest;
      if (parts[0] === 'whatsapp-sender-binding' && parts[1] === 'sender')
        return senderBindingDigest;
      return 'f'.repeat(64);
    },
  } as const;
}

function storedCapability(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    version: 1 as const,
    runtimeAudience: 'home-dev' as const,
    runId: 'run_1',
    leaseFence: '7',
    userId: 'private_user_fixture',
    scenarioId: 'scenario_1',
    scenarioNumber: 1,
    scenarioLabel: 'Scenario 001/020',
    matrixRoomBindingDigest: '7'.repeat(64),
    whatsappAccountBindingDigest: accountBindingDigest,
    whatsappSenderBindingDigest: senderBindingDigest,
    matrixIdempotencyKeyDigest: '0'.repeat(64),
    promptNormalizationVersion: 1 as const,
    promptDigest: digestMatrixCorpusPromptV1({ body: 'hello', startNewSession: true }),
    phase: 'start' as const,
    turnIndex: 0,
    expectedSessionId: null,
    pendingConfirmationId: null,
    expectedDecision: null,
    mockProfile: {
      version: 1 as const,
      calls: [],
      forbiddenSelections: [],
      unexpectedKnownToolPolicy: 'behavioral_failure_no_execution' as const,
    },
    mockProfileDigest: createHash('sha256').update('fixture').digest('hex'),
    expectedToolSchedule: [],
    currentDateTime: timestamp,
    timeZone: 'Europe/Warsaw',
    capabilityDigest,
    issueRequestDigest: '2'.repeat(64),
    issuedAt: '2026-07-20T10:00:02.000Z',
    expiresAt: '2026-07-20T10:01:02.000Z',
    consumedAt: null,
    consumedTransportMessageIdDigest: null,
    ingestOutboxId: null,
    revokedAt: null,
    ...overrides,
  };
}

function corpusMessage(text: string) {
  const message = parseMatrixCorpusVisibleMessage(text);
  if (message.kind !== 'matrix_corpus') throw new Error('fixture parse failed');
  return message;
}

function startInput() {
  return inputFor(
    corpusMessage(
      `new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · ${rawCapability}\n\nhello`
    )
  );
}

function inputFor(message: ReturnType<typeof corpusMessage>) {
  return {
    message,
    userId: 'private_user_fixture',
    transportMessageId: 'wamid.fixture_matrix',
    webhookEventId: 'webhook_matrix',
    senderPhoneNumber: 'sender',
    recipientPhoneNumber: 'recipient',
    whatsappAccountId: 'account',
    timestamp,
  };
}

function ingressFixture(
  stored: unknown | null,
  resultCode = 'INGEST_ENQUEUED',
  digests = ingressDigests()
) {
  const fake = createFakeFirestore();
  fake.clear();
  if (stored !== null) {
    fake.seedCollection(MATRIX_CORPUS_CAPABILITIES_COLLECTION, [
      { id: capabilityDigest, data: stored as Record<string, unknown> },
    ]);
  }
  const consumeCapabilityAndEnqueueIngest = vi.fn().mockResolvedValue({ code: resultCode });
  return {
    consumeCapabilityAndEnqueueIngest,
    ingress: new FirestoreMatrixCorpusIngress({
      firestore: fake as unknown as Firestore,
      controlPlane: { consumeCapabilityAndEnqueueIngest } as never,
      digests,
      sha256: createMatrixCorpusSha256(),
      expectedMatrixRoomBindingDigest: '7'.repeat(64),
      expectedWhatsAppAccountBindingDigest: accountBindingDigest,
      expectedWhatsAppSenderBindingDigest: senderBindingDigest,
    }),
  };
}
