import { createHash, generateKeyPairSync } from 'node:crypto';

import { ok } from '@intexuraos/common-core';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import {
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusStrictToolMockProfileV1,
  type MatrixCorpusAttestationClaimsV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import { IntexAgentModels } from '@intexuraos/llm-contract';
import { describe, expect, it, vi } from 'vitest';

import type {
  IntexAgentRunner,
  IntexAgentRunnerResult,
} from '../../domain/messages/handleIncomingMessage.js';
import type { PromptPreferencesRepository } from '../../domain/ports/promptPreferencesRepository.js';
import { emptyPromptPreferences } from '../../domain/preferences/promptPreferences.js';
import { FirestoreSessionRepository } from '../../infra/firestore/sessionRepository.js';
import { createIntexMatrixCorpusRuntime } from '../../services.js';

const NOW = '2026-07-20T10:00:00.000Z';
const USER_ID = 'auth0:user_1';
const RUN_ID = 'run_1';
const SCENARIO_ID = 'scenario_001';
const LEASE_FENCE = '7';
const INGEST_RECEIPT_ID = 'receipt_1';
const AGENT_MODEL = IntexAgentModels.DeepSeekV4Flash;

describe('Matrix corpus ingress composition', () => {
  it('closes a signed-lane turn and exposes only exact safe tool and usage evidence', async () => {
    const firestore = createFakeFirestore();
    const sessionRepository = new FirestoreSessionRepository({ firestore: firestore as never });
    const { publicKey } = generateKeyPairSync('ed25519');
    const publishReplyWithReceipt = vi.fn(async () => ({
      publicationReceiptId: 'pubsub_message_1',
    }));
    const runtime = createIntexMatrixCorpusRuntime(
      {
        enabled: true,
        runtimeAudience: 'home-dev',
        signingKeyVersion: 'matrix-test-v1',
        signingKeyMaterial: 'injected-in-this-test',
        evaluatorUserId: USER_ID,
        contextEncryptionKeyVersion: 'context-key-v1',
        contextEncryptionKeyMaterial: Buffer.alloc(32, 7).toString('base64url'),
      },
      {
        firestore: firestore as never,
        verificationKey: publicKey,
        promptPreferencesRepository: promptPreferencesRepository(),
        runtimeSettingsClient: {
          resolveIntexAgentRuntimeSettings: vi.fn(async () =>
            ok({
              status: 'available' as const,
              effectiveModel: AGENT_MODEL,
              explicitModel: AGENT_MODEL,
              source: 'explicit' as const,
              revision: 1,
              timeZone: 'Europe/Warsaw',
            })
          ),
        },
        sessionRepository,
        createRunner: ({ execution }) =>
          ({
            async run(input): Promise<IntexAgentRunnerResult> {
              await execution.recordExecutionBoundary('strict_mock_executor_resolved');
              await execution.recordToolCallStarted({
                toolName: 'query_calendar_events',
                turnIndex: 0,
                ordinal: 1,
                facts: [
                  { name: 'mode', value: 'count' },
                  { name: 'hasCalendarId', value: false },
                ],
              });
              const providerContext = {
                  version: 1,
                  runId: RUN_ID,
                  scenarioId: SCENARIO_ID,
                  sessionId: input.session.id,
                  turnIndex: 0,
                  stage: 'agent_generation',
                  callOrdinal: 1,
                } as const;
              execution.registerExpectedProviderCall(providerContext);
              await execution.recordProviderCall({
                context: providerContext,
                modelId: AGENT_MODEL,
                inputTokens: 10,
                outputTokens: 20,
                totalTokens: 30,
                providerReportedUsd: 0.001,
              });
              return {
                outcome: 'completed',
                reply: 'private-assistant-reply-sentinel',
                toolName: 'query_calendar_events',
                toolSelection: { turnIndex: 0, ordinal: 1 },
                toolResult: {
                  mode: 'count',
                  count: 0,
                  credential: 'private-tool-result-sentinel',
                },
              };
            },
            async executeConfirmed(): Promise<IntexAgentRunnerResult> {
              throw new Error('not used');
            },
          }) satisfies IntexAgentRunner,
        replyPublisher: { publishReplyWithReceipt },
        now: () => NOW,
      }
    );

    await expect(
      runtime.contextService.registerRun({
        runtimeAudience: 'home-dev',
        runId: RUN_ID,
        userId: USER_ID,
        leaseFence: LEASE_FENCE,
        catalogDigest: 'a'.repeat(64),
        agentModel: AGENT_MODEL,
        evaluatorModel: 'or:minimax/minimax-m3',
        expectedTimeZone: 'Europe/Warsaw',
      })
    ).resolves.toMatchObject({ ok: true });

    const claims = ingestClaims();
    await expect(runtime.acceptVerifiedIngest(claims)).resolves.toEqual({
      accepted: true,
      state: 'completed',
      correlationCount: 1,
    });

    const sessionId = deterministicSessionId(INGEST_RECEIPT_ID);
    const identity = {
      runId: RUN_ID,
      scenarioId: SCENARIO_ID,
      sessionId,
      userId: USER_ID,
      leaseFence: LEASE_FENCE,
    };
    const session = await sessionRepository.getMatrixCorpusSessionExact(identity);
    expect(session).toMatchObject({ ok: true, session: { lastEventSequence: 8 } });
    if (!session.ok) throw new Error('expected composed Matrix corpus session');

    const evidence = await runtime.evidenceService.getExact({
      identity,
      expectedEventRevision: session.session.lastEventSequence,
    });
    expect(evidence).toEqual({
      ok: true,
      evidence: {
        version: 1,
        eventRevision: 8,
        toolEvidence: [
          {
            event: 'selected',
            toolName: 'query_calendar_events',
            turnIndex: 0,
            ordinal: 1,
            facts: [
              { name: 'mode', value: 'count' },
              { name: 'hasCalendarId', value: false },
            ],
          },
          {
            event: 'mock_completed',
            toolName: 'query_calendar_events',
            turnIndex: 0,
            ordinal: 1,
            facts: [
              { name: 'resultCount', value: 0 },
              { name: 'mode', value: 'count' },
            ],
          },
        ],
        agentUsage: [
          {
            turnIndex: 0,
            stage: 'agent_generation',
            callOrdinal: 1,
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            costNanoUsd: 1_000_000,
          },
        ],
        agentUsageTotals: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          costNanoUsd: 1_000_000,
        },
        turnTerminals: [
          {
            status: 'completed',
            turnIndex: 0,
            replyCount: 1,
            replyDigests: [expect.stringMatching(/^[0-9a-f]{64}$/u)],
            terminalMarkerDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
            recordedAt: '2026-07-20T10:00:00.000Z',
          },
        ],
        strictMockProof: {
          version: 1,
          status: 'passed',
          executionMode: 'strict_mock_tools',
          mockProfileDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
          productionExecutorResolutions: 0,
          productionExecutorAdmissions: 0,
        },
      },
    });
    expect(JSON.stringify(evidence)).not.toMatch(
      /auth0:user_1|private-user-prompt-sentinel|private-assistant-reply-sentinel|private-tool-result-sentinel|deepseek/iu
    );
    expect(publishReplyWithReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        message: 'private-assistant-reply-sentinel',
        idempotencyKey: expect.stringMatching(/^imc_reply_publish_/u),
      })
    );
  });
});

function ingestClaims(): Extract<
  MatrixCorpusAttestationClaimsV1,
  Readonly<{ kind: 'matrix_corpus_ingest' }>
> {
  const mockProfile: StrictToolMockProfileV1 = {
    version: 1,
    calls: [
      {
        turnIndex: 0,
        toolName: 'query_calendar_events',
        ordinal: 1,
        outcome: {
          kind: 'success',
          result: {
            toolName: 'query_calendar_events',
            status: 'completed',
            mode: 'count',
            count: 0,
          },
        },
      },
    ],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
  };
  const payload = {
    version: 1 as const,
    kind: 'matrix_corpus_ingest_payload' as const,
    ordinaryIngest: {
      type: 'intex.message.ingest' as const,
      userId: USER_ID,
      messageId: 'transport_message_1',
      text: 'private-user-prompt-sentinel',
      sourceType: 'whatsapp_text' as const,
      timestamp: NOW,
    },
    context: {
      version: 1 as const,
      kind: 'matrix_corpus' as const,
      runtimeAudience: 'home-dev' as const,
      leaseFence: LEASE_FENCE,
      ingestReceiptId: INGEST_RECEIPT_ID,
      runId: RUN_ID,
      scenarioId: SCENARIO_ID,
      scenarioNumber: 1,
      scenarioLabel: 'Scenario 001/020',
      turnIndex: 0,
      phase: 'start' as const,
      startNewSession: true,
      promptNormalizationVersion: 1 as const,
      promptDigest: 'b'.repeat(64),
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      mockProfile,
      mockProfileDigest: createHash('sha256')
        .update(canonicalMatrixCorpusStrictToolMockProfileV1(mockProfile), 'utf8')
        .digest('hex'),
      expectedToolSchedule: [
        { turnIndex: 0, toolName: 'query_calendar_events' as const, ordinal: 1 },
      ],
      currentDateTime: NOW,
      timeZone: 'Europe/Warsaw',
    },
  };
  return {
    version: 1 as const,
    kind: 'matrix_corpus_ingest' as const,
    issuer: 'whatsapp-service' as const,
    audience: 'intex-agent' as const,
    runtimeAudience: 'home-dev' as const,
    keyVersion: 'key_v1',
    eventId: INGEST_RECEIPT_ID,
    leaseFence: LEASE_FENCE,
    payloadDigest: createHash('sha256')
      .update(canonicalMatrixCorpusIngestPayloadV1(payload), 'utf8')
      .digest('hex'),
    issuedAt: NOW,
    expiresAt: '2026-07-20T10:05:00.000Z',
    payload,
  };
}

function deterministicSessionId(ingestReceiptId: string): string {
  const digest = createHash('sha256').update(ingestReceiptId, 'utf8').digest('hex').slice(0, 32);
  return `imc_session_${digest}`;
}

function promptPreferencesRepository(): PromptPreferencesRepository {
  return {
    async getCurrent(userId): Promise<ReturnType<typeof emptyPromptPreferences>> {
      return {
        ...emptyPromptPreferences(userId),
        renderedPromptBlock: 'private-prompt-preference-sentinel',
      };
    },
    async listVersions(): Promise<[]> {
      return [];
    },
    async getVersion(): Promise<null> {
      return null;
    },
    async addItem(): Promise<never> {
      throw new Error('not used');
    },
    async updateItem(): Promise<never> {
      throw new Error('not used');
    },
    async deleteItem(): Promise<never> {
      throw new Error('not used');
    },
  };
}
