import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import {
  composeIntexMatrixCorpusFeature,
  composeIntexAgentExecutionServices,
  createIntexMatrixCorpusRuntime,
  createMatrixCorpusRunner,
  MATRIX_CORPUS_MODEL_MAX_ATTEMPTS,
  MATRIX_CORPUS_MODEL_REQUEST_TIMEOUT_MS,
  MATRIX_CORPUS_MODEL_TURN_BUDGET_MS,
  createTestConversationRunnerService,
  createRuntimeBoundModelClients,
  resolveRuntimeSettingsWithDeadline,
  startCatalogNonBlocking,
  type AgentRunnerFactory,
  type CreateRuntimeBoundModelClientsInput,
  type CreateTestConversationRunnerServiceInput,
} from '../services.js';
import {
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusStrictToolMockProfileV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import { createIntexAgentRunner } from '../domain/agent/intexAgentRunner.js';
import type { IntexAgentToolExecutor } from '../domain/agent/toolDefinitions.js';
import {
  DEFAULT_INTEX_AGENT_MODEL,
  IntexAgentModels,
  type MatrixCorpusLlmCallContextV1,
} from '@intexuraos/llm-contract';
import { err, ok } from '@intexuraos/common-core';
import { createOpenRouterCatalogClient } from '@intexuraos/infra-openrouter';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import {
  addPromptPreferenceItem,
  deletePromptPreferenceItem,
  emptyPromptPreferences,
} from '../domain/preferences/promptPreferences.js';
import type {
  IntexAgentRunner,
  IntexAgentRunnerResult,
} from '../domain/messages/handleIncomingMessage.js';
import { handleIncomingMessage } from '../domain/messages/handleIncomingMessage.js';
import type { IntexAgentRuntimeSettingsV1 } from '@intexuraos/internal-clients';
import type {
  SessionRepository,
  SessionRepositorySessionUpdate,
} from '../domain/ports/sessionRepository.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
} from '../domain/sessions/types.js';
import type { TestConversationRunner } from '../domain/testConversation/runTestConversation.js';
import { FirestoreSessionRepository } from '../infra/firestore/sessionRepository.js';
import { FakeUsageSink } from '@intexuraos/llm-pricing';

describe('resolveRuntimeSettingsWithDeadline', () => {
  it('retains the successful closed User Service runtime DTO', async () => {
    const resolveIntexAgentRuntimeSettings = vi.fn(async () =>
      ok({
        status: 'available' as const,
        effectiveModel: DEFAULT_INTEX_AGENT_MODEL,
        explicitModel: null,
        source: 'default_absent' as const,
        revision: 0,
        timeZone: 'Europe/Warsaw',
      })
    );

    await expect(
      resolveRuntimeSettingsWithDeadline('user-123', { resolveIntexAgentRuntimeSettings })
    ).resolves.toMatchObject({ ok: true, value: { timeZone: 'Europe/Warsaw' } });
    expect(resolveIntexAgentRuntimeSettings).toHaveBeenCalledTimes(1);
  });

  it('returns a closed timeout error and clears the outer timer', async () => {
    vi.useFakeTimers();
    try {
      const result = resolveRuntimeSettingsWithDeadline('user-123', {
        resolveIntexAgentRuntimeSettings: async () => await new Promise(() => undefined),
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(result).resolves.toEqual(
        err({ code: 'TIMEOUT', message: 'User Service runtime settings request timed out' })
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('observes a late client rejection after the timeout without changing the outcome', async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      let rejectLate: ((reason: unknown) => void) | undefined;
      const resultPromise = resolveRuntimeSettingsWithDeadline('user-123', {
        resolveIntexAgentRuntimeSettings: async () =>
          await new Promise((_resolve, reject) => {
            rejectLate = reject;
          }),
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        error: { code: 'TIMEOUT' },
      });
      rejectLate?.(new Error('late-private-rejection'));
      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(unhandled).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      process.off('unhandledRejection', listener);
      vi.useRealTimers();
    }
  });
});

describe('Intex Matrix corpus composition gate', () => {
  it('does not construct a key, verifier, or receipt service while disabled', () => {
    const createEnabled = vi.fn(() => ({ enabled: true as const }));

    expect(
      composeIntexMatrixCorpusFeature(
        { enabled: false, runtimeAudience: 'disabled' },
        createEnabled
      )
    ).toBeNull();
    expect(createEnabled).not.toHaveBeenCalled();
  });

  it('constructs the Home Dev verification arm exactly once', () => {
    const runtime = { enabled: true as const };
    const createEnabled = vi.fn(() => runtime);
    const config = {
      enabled: true as const,
      runtimeAudience: 'hetzner-prod' as const,
      signingKeyVersion: 'matrix-test-v1',
      signingKeyMaterial: 'synthetic-public-jwk',
      evaluatorUserId: 'auth0:user_1',
      contextEncryptionKeyVersion: 'context-key-v1',
      contextEncryptionKeyMaterial: Buffer.alloc(32, 7).toString('base64url'),
    };

    expect(composeIntexMatrixCorpusFeature(config, createEnabled)).toBe(runtime);
    expect(createEnabled).toHaveBeenCalledTimes(1);
    expect(createEnabled).toHaveBeenCalledWith(config);
  });

  it('composes the real verifier and receipt arm without a Firestore write', async () => {
    const firestore = createFakeFirestore();
    firestore.clear();
    const { publicKey } = generateKeyPairSync('ed25519');
    const runtime = createIntexMatrixCorpusRuntime(
      {
        enabled: true,
        runtimeAudience: 'hetzner-prod',
        signingKeyVersion: 'matrix-test-v1',
        signingKeyMaterial: 'injected-in-this-test',
        evaluatorUserId: 'auth0:user_1',
        contextEncryptionKeyVersion: 'context-key-v1',
        contextEncryptionKeyMaterial: Buffer.alloc(32, 7).toString('base64url'),
      },
      {
        firestore: firestore as never,
        verificationKey: publicKey,
        promptPreferencesRepository: promptPreferencesRepository([]),
        runtimeSettingsClient: {
          resolveIntexAgentRuntimeSettings: vi.fn(async () =>
            ok({
              status: 'available' as const,
              effectiveModel: IntexAgentModels.DeepSeekV4Flash,
              explicitModel: null,
              source: 'default_absent' as const,
              revision: 0,
              timeZone: 'Europe/Warsaw',
            })
          ),
        },
        sessionRepository: new FirestoreSessionRepository({ firestore: firestore as never }),
        createRunner: vi.fn(() => ({
          run: vi.fn(),
          executeConfirmed: vi.fn(),
        }) as unknown as IntexAgentRunner),
        replyPublisher: {
          publishReplyWithReceipt: vi.fn(async () => ({
            publicationReceiptId: 'pubsub_message_1',
          })),
        },
        now: () => '2026-07-20T10:00:00.000Z',
      }
    );

    await expect(runtime.verifyAttestation({ invalid: true })).resolves.toEqual({
      ok: false,
      code: 'INVALID_ENVELOPE',
    });
    expect(firestore.getAllData().size).toBe(0);
  });

  it('executes a registered signed-lane ingest through the composed strict runtime', async () => {
    const firestore = createFakeFirestore();
    const { publicKey } = generateKeyPairSync('ed25519');
    const createRunner = vi.fn(() => ({
      run: vi.fn(async () => ({ outcome: 'no_action' as const, reply: 'Synthetic reply.' })),
      executeConfirmed: vi.fn(),
    }) as unknown as IntexAgentRunner);
    const publishReplyWithReceipt = vi.fn(async () => ({
      publicationReceiptId: 'pubsub_message_1',
    }));
    const runtime = createIntexMatrixCorpusRuntime(
      {
        enabled: true,
        runtimeAudience: 'hetzner-prod',
        signingKeyVersion: 'matrix-test-v1',
        signingKeyMaterial: 'injected-in-this-test',
        evaluatorUserId: 'auth0:user_1',
        contextEncryptionKeyVersion: 'context-key-v1',
        contextEncryptionKeyMaterial: Buffer.alloc(32, 7).toString('base64url'),
      },
      {
        firestore: firestore as never,
        verificationKey: publicKey,
        promptPreferencesRepository: promptPreferencesRepository([]),
        runtimeSettingsClient: {
          resolveIntexAgentRuntimeSettings: vi.fn(async () =>
            ok({
              status: 'available' as const,
              effectiveModel: IntexAgentModels.DeepSeekV4Flash,
              explicitModel: IntexAgentModels.DeepSeekV4Flash,
              source: 'explicit' as const,
              revision: 1,
              timeZone: 'Europe/Warsaw',
            })
          ),
        },
        sessionRepository: new FirestoreSessionRepository({ firestore: firestore as never }),
        createRunner,
        replyPublisher: { publishReplyWithReceipt },
        now: () => '2026-07-20T10:00:00.000Z',
      }
    );
    await expect(
      runtime.contextService.registerRun({
        runtimeAudience: 'hetzner-prod',
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        catalogDigest: 'a'.repeat(64),
        agentModel: 'or:deepseek/deepseek-v4-flash',
        evaluatorModel: 'or:minimax/minimax-m3',
        expectedTimeZone: 'Europe/Warsaw',
      })
    ).resolves.toMatchObject({ ok: true });
    const profile: StrictToolMockProfileV1 = {
      version: 1,
      calls: [],
      forbiddenSelections: [],
      unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
    };
    const payload = {
      version: 1 as const,
      kind: 'matrix_corpus_ingest_payload' as const,
      ordinaryIngest: {
        type: 'intex.message.ingest' as const,
        userId: 'auth0:user_1',
        messageId: 'transport_message_1',
        text: 'Synthetic request.',
        sourceType: 'whatsapp_text' as const,
        timestamp: '2026-07-20T10:00:00.000Z',
      },
      context: {
        version: 1 as const,
        kind: 'matrix_corpus' as const,
        runtimeAudience: 'hetzner-prod' as const,
        leaseFence: '7',
        ingestReceiptId: 'receipt_1',
        runId: 'run_1',
        scenarioId: 'scenario_001',
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
        mockProfile: profile,
        mockProfileDigest: createHash('sha256')
          .update(canonicalMatrixCorpusStrictToolMockProfileV1(profile), 'utf8')
          .digest('hex'),
        expectedToolSchedule: [],
        currentDateTime: '2026-07-20T10:00:00.000Z',
        timeZone: 'Europe/Warsaw',
      },
    };
    const payloadDigest = createHash('sha256')
      .update(canonicalMatrixCorpusIngestPayloadV1(payload), 'utf8')
      .digest('hex');

    const acceptance = await runtime.acceptVerifiedIngest({
        version: 1,
        kind: 'matrix_corpus_ingest',
        issuer: 'whatsapp-service',
        audience: 'intex-agent',
        runtimeAudience: 'hetzner-prod',
        keyVersion: 'key_v1',
        eventId: 'receipt_1',
        leaseFence: '7',
        payloadDigest,
        issuedAt: '2026-07-20T10:00:00.000Z',
        expiresAt: '2026-07-20T10:05:00.000Z',
        payload,
      });
    const persistedReceipt = await firestore
      .collection('intex_agent_matrix_corpus_ingest_receipts')
      .doc('receipt_1')
      .get();
    expect({ acceptance, persistedReceipt: persistedReceipt.data() }).toMatchObject({
      acceptance: { accepted: true, state: 'completed', correlationCount: 1 },
      persistedReceipt: {
        state: 'completed',
        failureCode: null,
        publication: {
          phase: 'closed',
          expectedReplyDigests: [expect.stringMatching(/^[0-9a-f]{64}$/u)],
          replies: [{ state: 'accepted' }],
          terminal: { kind: 'completed' },
        },
      },
    });
    expect(createRunner).toHaveBeenCalledOnce();
    expect(publishReplyWithReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Synthetic reply.', idempotencyKey: expect.any(String) })
    );
  });
});

describe('Matrix corpus runner composition', () => {
  it('fails closed when Matrix corpus generation fails or omits provider usage', async () => {
    const profile = strictProfile();
    const failed = normalMatrixRunner({
      run: vi.fn(async () => err({ code: 'API_ERROR' as const, message: 'provider failed' })),
    });
    const incomplete = normalMatrixRunner({
      run: vi.fn(async () =>
        ok({
          content: JSON.stringify({ outcome: 'no_action', reply: 'No action.' }),
          toolCallsMade: 0,
          iterationCount: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.0001 },
        })
      ),
    });
    const input: Parameters<typeof failed.runner.run>[0] = {
      session: matrixCorpusSession(profile),
      events: [],
      message: 'No action.',
      currentDateTime: '2026-07-20T10:00:00.000Z',
      timeZone: 'Europe/Warsaw',
    };

    await expect(failed.runner.run(input)).rejects.toThrowError(
      'Matrix corpus agent generation failed'
    );
    await expect(incomplete.runner.run(input)).rejects.toThrowError(
      'Matrix corpus provider usage is incomplete'
    );
  });

  it('deduplicates identical provider callbacks and rejects conflicting replay', async () => {
    const profile = strictProfile();
    const runWithReplay = (conflicting: boolean): ReturnType<typeof normalMatrixRunner> => {
      const fixture = normalMatrixRunner({
        run: vi.fn(async (params) => {
          if (
            params.matrixCorpusContext === undefined ||
            params.onMatrixCorpusProviderCall === undefined
          )
            throw new Error('missing Matrix corpus provider hooks');
          const call = {
            context: params.matrixCorpusContext,
            modelId: 'or:deepseek/deepseek-v4-flash',
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            providerReportedUsd: 0.0001,
          };
          await params.onMatrixCorpusProviderCall(call);
          await params.onMatrixCorpusProviderCall(
            conflicting ? { ...call, inputTokens: 2, totalTokens: 3 } : call
          );
          return ok({
            content: JSON.stringify({ outcome: 'no_action', reply: 'No action.' }),
            toolCallsMade: 0,
            iterationCount: 1,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.0001 },
            providerCalls: [call],
          });
        }),
      });
      return fixture;
    };
    const input: Parameters<typeof identical.runner.run>[0] = {
      session: matrixCorpusSession(profile),
      events: [],
      message: 'No action.',
      currentDateTime: '2026-07-20T10:00:00.000Z',
      timeZone: 'Europe/Warsaw',
    };
    const identical = runWithReplay(false);

    await expect(identical.runner.run(input)).resolves.toMatchObject({ outcome: 'no_action' });
    expect(identical.recordProviderCall).toHaveBeenCalledTimes(1);
    await expect(runWithReplay(true).runner.run(input)).rejects.toThrowError(
      'Matrix corpus provider usage replay conflict'
    );
  });

  it('returns the strict mock failure reply with recorded selection metadata and category', async () => {
    const profile = strictProfile({
      calls: [
        {
          turnIndex: 0,
          toolName: 'query_calendar_events',
          ordinal: 1,
          outcome: { kind: 'failure', code: 'MOCK_TOOL_FAILURE' },
        },
      ],
    });
    const client = {
      run: vi.fn(async (params: Parameters<import('@intexuraos/llm-contract').ToolCallingClient['run']>[0]) => {
        const tool = params.tools.find((candidate) => candidate.name === 'query_calendar_events');
        if (tool === undefined || params.matrixCorpusContext === undefined)
          throw new Error('missing strict tool or provider context');
        await expect(
          tool.run({
            mode: 'count',
            timeMin: '2026-07-20T00:00:00Z',
            timeMax: '2026-07-21T00:00:00Z',
          })
        ).rejects.toMatchObject({ category: 'configured_failure' });
        const providerCall = {
          context: params.matrixCorpusContext,
          modelId: 'or:deepseek/deepseek-v4-flash',
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          providerReportedUsd: 0.0001,
        };
        return ok({
          content: JSON.stringify({
            outcome: 'completed',
            reply: 'Synthetic configured failure.',
            toolName: 'query_calendar_events',
          }),
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.0001 },
          providerCalls: [providerCall],
        });
      }),
    };
    const runner = createMatrixCorpusRunner({
      execution: {
        flow: 'normal',
        turnIndex: 0,
        ingestReceiptId: 'receipt_configured_failure',
        expectedSchedule: [
          { turnIndex: 0, toolName: 'query_calendar_events', ordinal: 1 },
        ],
        recordExecutionBoundary: vi.fn(async () => undefined),
        recordToolCallStarted: vi.fn(async () => undefined),
        registerExpectedProviderCall: vi.fn(),
        recordProviderCall: vi.fn(async () => undefined),
      },
      client,
      intentClassifier: {
        async classify() {
          return { kind: 'tool' as const, allowedToolNames: ['query_calendar_events'] };
        },
      },
      userPreferences: null,
    });

    await expect(
      runner.run({
        session: matrixCorpusSession(profile),
        events: [],
        message: 'Create a synthetic note.',
        currentDateTime: '2026-07-20T10:00:00.000Z',
        timeZone: 'Europe/Warsaw',
      })
    ).resolves.toMatchObject({
      outcome: 'tool_failed',
      reply: 'Synthetic configured failure.',
      errorCategory: 'configured_failure',
      toolSelection: { turnIndex: 0, ordinal: 1 },
    });
  });

  it('uses deterministic fallback metadata when an ordinary read-only tool throws an untyped error', async () => {
    const error = Object.assign(new Error('Synthetic ordinary failure'), { category: 7 });
    const client = {
      run: vi.fn(async (params: Parameters<import('@intexuraos/llm-contract').ToolCallingClient['run']>[0]) => {
        const tool = params.tools.find((candidate) => candidate.name === 'query_calendar_events');
        if (tool === undefined) throw new Error('missing ordinary query tool');
        await expect(
          tool.run({
            mode: 'count',
            timeMin: '2026-07-20T00:00:00Z',
            timeMax: '2026-07-21T00:00:00Z',
          })
        ).rejects.toBe(error);
        return ok({
          content: 'malformed runner output',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
        });
      }),
    };
    const runner = createIntexAgentRunner({
      client,
      toolExecutor: {
        ...emptyToolExecutor(),
        async queryCalendarEvents() {
          throw error;
        },
      },
      intentClassifier: {
        async classify() {
          return { kind: 'tool' as const, allowedToolNames: ['query_calendar_events'] };
        },
      },
    });

    await expect(
      runner.run({
        session: matrixCorpusSession(strictProfile()),
        events: [],
        message: 'Count calendar events.',
        currentDateTime: '2026-07-20T10:00:00.000Z',
        timeZone: 'Europe/Warsaw',
      })
    ).resolves.toEqual({
      outcome: 'tool_failed',
      reply:
        'I could not execute this action: Synthetic ordinary failure. Please try again later.',
      toolName: 'query_calendar_events',
      error: 'Synthetic ordinary failure',
      errorCategory: 'unknown',
      isRetryable: false,
      attemptedAction: 'query_calendar_events',
    });
  });

  it('correlates a Matrix corpus response-schema repair as a separate provider call', async () => {
    const profile = strictProfile();
    const registerExpectedProviderCall = vi.fn();
    const recordProviderCall = vi.fn(async () => undefined);
    const client = {
      run: vi.fn(async (params: Parameters<import('@intexuraos/llm-contract').ToolCallingClient['run']>[0]) => {
        if (params.matrixCorpusContext === undefined)
          throw new Error('missing generation context');
        return ok({
          content: 'malformed runner output',
          toolCallsMade: 0,
          iterationCount: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.0001 },
          providerCalls: [
            {
              context: params.matrixCorpusContext,
              modelId: 'or:deepseek/deepseek-v4-flash',
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
              providerReportedUsd: 0.0001,
            },
          ],
        });
      }),
    };
    const responseRepairClient = {
      generate: vi.fn(async (_prompt, options: Parameters<import('@intexuraos/llm-utils').StructuredClient['generate']>[1]) => {
        const context = options['matrixCorpusContext'] as
          | MatrixCorpusLlmCallContextV1
          | undefined;
        if (context === undefined) throw new Error('missing repair context');
        return ok({
          content: JSON.stringify({ outcome: 'no_action', reply: 'Repaired response.' }),
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.0001 },
          providerCall: {
            context,
            modelId: 'or:deepseek/deepseek-v4-flash',
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            providerReportedUsd: 0.0001,
          },
        });
      }),
    };
    const runner = createMatrixCorpusRunner({
      execution: {
        flow: 'normal',
        turnIndex: 0,
        ingestReceiptId: 'receipt_response_repair',
        expectedSchedule: [],
        recordExecutionBoundary: vi.fn(async () => undefined),
        recordToolCallStarted: vi.fn(async () => undefined),
        registerExpectedProviderCall,
        recordProviderCall,
      },
      client,
      responseRepairClient,
      intentClassifier: {
        async classify() {
          return { kind: 'no_action' as const, reason: 'conversation' as const };
        },
      },
      userPreferences: null,
    });

    await expect(
      runner.run({
        session: matrixCorpusSession(profile),
        events: [],
        message: 'Repair this.',
        currentDateTime: '2026-07-20T10:00:00.000Z',
        timeZone: 'Europe/Warsaw',
      })
    ).resolves.toEqual({ outcome: 'no_action', reply: 'Repaired response.' });
    expect(registerExpectedProviderCall.mock.calls.map(([context]) => context.stage)).toEqual([
      'agent_generation',
      'response_schema_repair',
    ]);
    expect(recordProviderCall).toHaveBeenCalledTimes(2);
  });

  it('runs a normal turn through the strict boundary without any production executor', async () => {
    const recordExecutionBoundary = vi.fn(async () => undefined);
    const recordToolCallStarted = vi.fn(async () => undefined);
    const registerExpectedProviderCall = vi.fn();
    const recordProviderCall = vi.fn(async () => undefined);
    const profile = strictProfile({
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
    });
    const client = {
      run: vi.fn(async (params: Parameters<import('@intexuraos/llm-contract').ToolCallingClient['run']>[0]) => {
        const tool = params.tools.find((candidate) => candidate.name === 'query_calendar_events');
        if (tool === undefined) throw new Error('strict tool missing');
        await tool.run({
          mode: 'count',
          timeMin: '2026-07-20T00:00:00Z',
          timeMax: '2026-07-21T00:00:00Z',
        });
        if (params.matrixCorpusContext === undefined) throw new Error('missing usage context');
        return ok({
          content: JSON.stringify({
            outcome: 'completed',
            reply: 'No events.',
            toolName: 'query_calendar_events',
          }),
          toolCallsMade: 1,
          iterationCount: 2,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.0001 },
          providerCalls: [
            {
              context: params.matrixCorpusContext,
              modelId: 'or:deepseek/deepseek-v4-flash',
              inputTokens: 1,
              outputTokens: 0,
              totalTokens: 1,
              providerReportedUsd: 0.00004,
            },
            {
              context: {
                ...params.matrixCorpusContext,
                callOrdinal: (params.matrixCorpusContext?.callOrdinal ?? 0) + 1,
              },
              modelId: 'or:deepseek/deepseek-v4-flash',
              inputTokens: 0,
              outputTokens: 1,
              totalTokens: 1,
              providerReportedUsd: 0.00006,
            },
          ],
        });
      }),
    };
    const runner = createMatrixCorpusRunner({
      execution: {
        flow: 'normal',
        turnIndex: 0,
        ingestReceiptId: 'receipt_normal',
        expectedSchedule: profile.calls.map(({ turnIndex, toolName, ordinal }) => ({
          turnIndex,
          toolName,
          ordinal,
        })),
        recordExecutionBoundary,
        recordToolCallStarted,
        registerExpectedProviderCall,
        recordProviderCall,
      },
      client,
      intentClassifier: {
        async classify() {
          return { kind: 'tool' as const, allowedToolNames: ['query_calendar_events'] };
        },
      },
      userPreferences: null,
    });

    await expect(
      runner.run({
        session: matrixCorpusSession(profile),
        events: [],
        message: 'Ile mam wydarzeń dzisiaj?',
        currentDateTime: '2026-07-20T10:00:00.000Z',
        timeZone: 'Europe/Warsaw',
      })
    ).resolves.toMatchObject({
      outcome: 'completed',
      toolName: 'query_calendar_events',
      toolSelection: { turnIndex: 0, ordinal: 1 },
    });
    expect(recordToolCallStarted).toHaveBeenCalledOnce();
    expect(recordExecutionBoundary).toHaveBeenCalledOnce();
    expect(recordExecutionBoundary).toHaveBeenCalledWith('strict_mock_executor_resolved');
    expect(recordProviderCall).toHaveBeenCalledTimes(2);
    expect(client.run).toHaveBeenCalledOnce();
  });

  it('executes an accepted confirmation with the exact preauthorized mock and zero LLM calls', async () => {
    const profile = strictProfile({
      calls: [
        {
          turnIndex: 0,
          toolName: 'create_note',
          ordinal: 1,
          outcome: {
            kind: 'success',
            result: {
              toolName: 'create_note',
              status: 'completed',
              message: 'Synthetic note saved',
            },
          },
        },
      ],
    });
    const recordToolCallStarted = vi.fn(async () => undefined);
    const recordExecutionBoundary = vi.fn(async () => undefined);
    const registerExpectedProviderCall = vi.fn();
    const recordProviderCall = vi.fn(async () => undefined);
    const runner = createMatrixCorpusRunner({
      execution: {
        flow: 'confirmation',
        turnIndex: 0,
        ingestReceiptId: 'receipt_confirmation',
        expectedSchedule: profile.calls.map(({ turnIndex, toolName, ordinal }) => ({
          turnIndex,
          toolName,
          ordinal,
        })),
        recordExecutionBoundary,
        recordToolCallStarted,
        registerExpectedProviderCall,
        recordProviderCall,
        preauthorizedSelection: {
          toolName: 'create_note',
          turnIndex: 0,
          ordinal: 1,
        },
      },
      userPreferences: null,
    });

    await expect(
      runner.executeConfirmed({
        session: matrixCorpusSession(profile),
        events: [],
        toolName: 'create_note',
        toolArgs: { content: 'Synthetic note' },
        currentDateTime: '2026-07-20T10:00:00.000Z',
      })
    ).resolves.toMatchObject({
      outcome: 'completed',
      toolName: 'create_note',
      toolResult: { toolName: 'create_note', status: 'completed' },
    });
    expect(recordToolCallStarted).toHaveBeenCalledWith({
      toolName: 'create_note',
      turnIndex: 0,
      ordinal: 1,
      facts: expect.any(Array),
    });
    expect(recordExecutionBoundary).toHaveBeenCalledWith('strict_mock_executor_resolved');
  });

  it('carries a mutating preview into the following strict confirmation turn without executing it early', async () => {
    const profile = strictProfile({
      calls: [
        {
          turnIndex: 1,
          toolName: 'create_note',
          ordinal: 1,
          outcome: {
            kind: 'success',
            result: {
              toolName: 'create_note',
              status: 'completed',
              message: 'Synthetic note saved',
            },
          },
        },
      ],
      forbiddenSelections: [{ turnIndex: 0, toolName: 'create_note' }],
    });
    const recordPreviewExecution = vi.fn(async () => undefined);
    const previewClient = {
      run: vi.fn(async (params: Parameters<import('@intexuraos/llm-contract').ToolCallingClient['run']>[0]) => {
        const tool = params.tools.find((candidate) => candidate.name === 'create_note');
        if (tool === undefined) throw new Error('strict preview tool missing');
        await tool.run({ content: 'Synthetic note' });
        if (params.matrixCorpusContext === undefined) throw new Error('missing usage context');
        return ok({
          content: JSON.stringify({
            outcome: 'needs_confirmation',
            reply: 'Confirm synthetic note creation.',
            toolName: 'create_note',
            toolArgs: { content: 'Synthetic note' },
          }),
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.0001 },
          providerCalls: [
            {
              context: params.matrixCorpusContext,
              modelId: 'or:deepseek/deepseek-v4-flash',
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
              providerReportedUsd: 0.0001,
            },
          ],
        });
      }),
    };
    const previewRunner = createMatrixCorpusRunner({
      execution: {
        flow: 'normal',
        turnIndex: 0,
        ingestReceiptId: 'receipt_preview',
        expectedSchedule: [{ turnIndex: 1, toolName: 'create_note', ordinal: 1 }],
        recordExecutionBoundary: vi.fn(async () => undefined),
        recordToolCallStarted: recordPreviewExecution,
        registerExpectedProviderCall: vi.fn(),
        recordProviderCall: vi.fn(async () => undefined),
      },
      client: previewClient,
      intentClassifier: {
        async classify() {
          return { kind: 'tool' as const, allowedToolNames: ['create_note'] };
        },
      },
      userPreferences: null,
    });

    const preview = await previewRunner.run({
      session: matrixCorpusSession(profile),
      events: [],
      message: 'Create a synthetic note.',
      currentDateTime: '2026-07-20T10:00:00.000Z',
      timeZone: 'Europe/Warsaw',
    });
    expect(preview).toMatchObject({
      outcome: 'needs_confirmation',
      toolSelection: { turnIndex: 1, ordinal: 1 },
    });
    expect(recordPreviewExecution).not.toHaveBeenCalled();

    const recordConfirmedExecution = vi.fn(async () => undefined);
    const recordConfirmedBoundary = vi.fn(async () => undefined);
    const confirmedRunner = createMatrixCorpusRunner({
      execution: {
        flow: 'confirmation',
        turnIndex: 1,
        ingestReceiptId: 'receipt_confirmation',
        expectedSchedule: [{ turnIndex: 1, toolName: 'create_note', ordinal: 1 }],
        recordExecutionBoundary: recordConfirmedBoundary,
        recordToolCallStarted: recordConfirmedExecution,
        registerExpectedProviderCall: vi.fn(),
        recordProviderCall: vi.fn(async () => undefined),
        preauthorizedSelection: { toolName: 'create_note', turnIndex: 1, ordinal: 1 },
      },
      userPreferences: null,
    });
    await expect(
      confirmedRunner.executeConfirmed({
        session: matrixCorpusSession(profile),
        events: [],
        toolName: 'create_note',
        toolArgs: { content: 'Synthetic note' },
        currentDateTime: '2026-07-20T10:00:01.000Z',
      })
    ).resolves.toMatchObject({ outcome: 'completed', toolName: 'create_note' });
    expect(recordConfirmedExecution).toHaveBeenCalledWith({
      toolName: 'create_note',
      turnIndex: 1,
      ordinal: 1,
      facts: expect.any(Array),
    });
    expect(recordConfirmedBoundary).toHaveBeenCalledWith('strict_mock_executor_resolved');
  });

  it('fails before executor construction for a cross-lane ordinary session', async () => {
    const profile = strictProfile();
    const recordExecutionBoundary = vi.fn(async () => undefined);
    const runner = createMatrixCorpusRunner({
      execution: {
        flow: 'normal',
        turnIndex: 0,
        ingestReceiptId: 'receipt_cross_lane',
        expectedSchedule: profile.calls.map(({ turnIndex, toolName, ordinal }) => ({
          turnIndex,
          toolName,
          ordinal,
        })),
        recordExecutionBoundary,
        recordToolCallStarted: vi.fn(async () => undefined),
        registerExpectedProviderCall: vi.fn(),
        recordProviderCall: vi.fn(async () => undefined),
      },
      client: fakeToolCallingClient(),
      userPreferences: null,
    });

    await expect(
      runner.run({
        session: {
          id: 'ordinary_session',
          userId: 'auth0:user_1',
          channel: 'whatsapp',
          status: 'active',
          startedAt: '2026-07-20T10:00:00.000Z',
          lastUserMessageAt: '2026-07-20T10:00:00.000Z',
          startReason: 'no_active_session',
        },
        events: [],
        message: 'hello',
        currentDateTime: '2026-07-20T10:00:00.000Z',
        timeZone: 'Europe/Warsaw',
      })
    ).rejects.toMatchObject({ code: 'CROSS_LANE_EXECUTION_CONTEXT' });
    expect(recordExecutionBoundary).not.toHaveBeenCalled();
  });
});

describe('catalog startup and evaluator admission', () => {
  it('awaits one successful catalog startup without warning', async () => {
    const start = vi.fn(async () => ({ catalog: {}, fetchedAt: '2026-07-19T12:00:00.000Z' }));
    const logger = silentLogger();
    const warn = vi.spyOn(logger, 'warn');

    await startCatalogNonBlocking({ start }, logger);

    expect(start).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not block startup when the catalog client unexpectedly rejects', async () => {
    const logger = silentLogger();
    const warn = vi.spyOn(logger, 'warn');

    await expect(
      startCatalogNonBlocking(
        { start: async () => Promise.reject(new Error('catalog-start-private-cause')) },
        logger
      )
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      { reason: 'catalog_start_failed' },
      'Intex Agent OpenRouter catalog startup failed'
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('catalog-start-private-cause');
  });

  it('admits with the exact startup catalog instance and fails closed before factories', async () => {
    const evidence = admittedCatalog();
    const createToolCallingClientFn = vi.fn(() => fakeToolCallingClient());
    const createLlmClientFn = vi.fn(() => fakeStructuredClient());
    const createAgentRunnerFn: AgentRunnerFactory = vi.fn(() => {
      throw new Error('must not construct runner');
    });
    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: new MemorySessionRepository(),
      promptPreferencesRepository: promptPreferencesRepository([]),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      catalogClient: evidence,
      createToolCallingClientFn,
      createLlmClientFn,
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });
    vi.mocked(evidence.getIntexAgentCatalogEvidence).mockResolvedValueOnce(null);

    await expect(runner.run(testConversationRequest('catalog-denied'))).rejects.toThrow(
      'Intex Agent evaluator catalog admission unavailable'
    );
    expect(evidence.getIntexAgentCatalogEvidence).toHaveBeenCalledTimes(1);
    expect(createToolCallingClientFn).not.toHaveBeenCalled();
    expect(createLlmClientFn).not.toHaveBeenCalled();
    expect(createAgentRunnerFn).not.toHaveBeenCalled();
  });

  it('recovers on later fresh evidence without replacing the admission instance', async () => {
    const catalogClient = admittedCatalog();
    vi.mocked(catalogClient.getIntexAgentCatalogEvidence)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(catalogEvidence());
    const createAgentRunnerFn: AgentRunnerFactory = vi.fn((): IntexAgentRunner => ({
      async run(): Promise<IntexAgentRunnerResult> {
        return { outcome: 'no_action', reply: 'Recovered.' };
      },
      async executeConfirmed(): Promise<IntexAgentRunnerResult> {
        throw new Error('not used');
      },
    }));
    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: new MemorySessionRepository(),
      promptPreferencesRepository: promptPreferencesRepository([]),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      catalogClient,
      createToolCallingClientFn: vi.fn(() => fakeToolCallingClient()),
      createLlmClientFn: vi.fn(() => fakeStructuredClient()),
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });

    await expect(runner.run(testConversationRequest('catalog-stale'))).rejects.toThrow();
    await expect(runner.run(testConversationRequest('catalog-recovered'))).resolves.toMatchObject({
      runId: 'catalog-recovered',
    });
    expect(catalogClient.getIntexAgentCatalogEvidence).toHaveBeenCalledTimes(2);
    expect(createAgentRunnerFn).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent stale evaluator admissions through the startup client', async () => {
    let nowMs = Date.parse('2026-07-19T12:00:00.000Z');
    let resolveRefresh: ((response: Response) => void) | undefined;
    const fetchImpl = vi
      .fn<(_: string | URL | Request, _init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(catalogResponse())
      .mockImplementationOnce(
        async () =>
          await new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
          })
      );
    const catalogClient = createOpenRouterCatalogClient({
      apiKey: 'platform-key',
      logger: silentLogger(),
      fetchImpl,
      now: () => new Date(nowMs),
    });
    await catalogClient.start();
    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: new MemorySessionRepository(),
      promptPreferencesRepository: promptPreferencesRepository([]),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      catalogClient,
      createToolCallingClientFn: vi.fn(() => fakeToolCallingClient()),
      createLlmClientFn: vi.fn(() => fakeStructuredClient()),
      createAgentRunnerFn: noActionAgentFactory(),
      ids: fixedTestIds(),
    });
    nowMs += 5 * 60 * 1_000;

    const first = runner.run(testConversationRequest('stale-concurrent-a'));
    const second = runner.run(testConversationRequest('stale-concurrent-b'));
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    if (resolveRefresh === undefined) throw new Error('refresh did not start');
    resolveRefresh(catalogResponse());

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails closed on stale refresh failure before every evaluator provider factory', async () => {
    let nowMs = Date.parse('2026-07-19T12:00:00.000Z');
    const fetchImpl = vi
      .fn<(_: string | URL | Request, _init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(catalogResponse())
      .mockRejectedValueOnce(new Error('stale-refresh-private-cause'));
    const catalogClient = createOpenRouterCatalogClient({
      apiKey: 'platform-key',
      logger: silentLogger(),
      fetchImpl,
      now: () => new Date(nowMs),
    });
    await catalogClient.start();
    nowMs += 5 * 60 * 1_000;
    const createToolCallingClientFn = vi.fn(() => fakeToolCallingClient());
    const createLlmClientFn = vi.fn(() => fakeStructuredClient());
    const createAgentRunnerFn = noActionAgentFactory();
    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: new MemorySessionRepository(),
      promptPreferencesRepository: promptPreferencesRepository([]),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      catalogClient,
      createToolCallingClientFn,
      createLlmClientFn,
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });

    await expect(runner.run(testConversationRequest('stale-refresh-failed'))).rejects.toThrow(
      'Intex Agent evaluator catalog admission unavailable'
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(createToolCallingClientFn).not.toHaveBeenCalled();
    expect(createLlmClientFn).not.toHaveBeenCalled();
    expect(createAgentRunnerFn).not.toHaveBeenCalled();
  });
});

describe('createRuntimeBoundModelClients', () => {
  it.each([
    IntexAgentModels.DeepSeekV4Flash,
    IntexAgentModels.MiniMaxM3,
    IntexAgentModels.Gemini3FlashPreview,
  ])('binds both product clients to the exact frozen snapshot model %s', (model) => {
    const createToolCallingClientFn = vi.fn(() => fakeToolCallingClient());
    const createLlmClientFn = vi.fn(() => fakeStructuredClient());
    const runtimeSettings = Object.freeze({
      status: 'available' as const,
      effectiveModel: model,
      explicitModel: model,
      source: 'explicit' as const,
      revision: 1,
      timeZone: 'UTC',
    });

    createRuntimeBoundModelClients({
      runtimeSettings,
      apiKey: 'platform-key',
      userId: 'user-1',
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      createToolCallingClientFn,
      createLlmClientFn,
    });

    expect(createToolCallingClientFn).toHaveBeenCalledTimes(1);
    expect(createLlmClientFn).toHaveBeenCalledTimes(1);
    expect(createToolCallingClientFn).toHaveBeenCalledWith(
      expect.objectContaining({ model, apiKey: 'platform-key' })
    );
    expect(createLlmClientFn).toHaveBeenCalledWith(
      expect.objectContaining({ model, apiKey: 'platform-key' })
    );
  });

  it('binds the Matrix corpus request policy to both DeepSeek clients', () => {
    const createToolCallingClientFn = vi.fn(() => fakeToolCallingClient());
    const createLlmClientFn = vi.fn(() => fakeStructuredClient());

    createRuntimeBoundModelClients({
      runtimeSettings: Object.freeze({
        status: 'available' as const,
        effectiveModel: IntexAgentModels.DeepSeekV4Flash,
        explicitModel: IntexAgentModels.DeepSeekV4Flash,
        source: 'explicit' as const,
        revision: 1,
        timeZone: 'Europe/Warsaw',
      }),
      apiKey: 'platform-key',
      userId: 'user-1',
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      timeoutMs: MATRIX_CORPUS_MODEL_REQUEST_TIMEOUT_MS,
      maxAttempts: MATRIX_CORPUS_MODEL_MAX_ATTEMPTS,
      deadlineAtMs: MATRIX_CORPUS_MODEL_TURN_BUDGET_MS,
      createToolCallingClientFn,
      createLlmClientFn,
    });

    expect(MATRIX_CORPUS_MODEL_REQUEST_TIMEOUT_MS).toBe(45_000);
    expect(MATRIX_CORPUS_MODEL_MAX_ATTEMPTS).toBe(2);
    expect(MATRIX_CORPUS_MODEL_TURN_BUDGET_MS).toBe(180_000);
    expect(createToolCallingClientFn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 45_000, maxAttempts: 2, deadlineAtMs: 180_000 })
    );
    expect(createLlmClientFn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 45_000, maxAttempts: 2, deadlineAtMs: 180_000 })
    );
  });

  it('shares one absolute Matrix turn deadline across the real structured and tool clients', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T10:00:00.000Z'));
    const startedAtMs = Date.now();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementationOnce(async () => {
      vi.setSystemTime(startedAtMs + 15);
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-structured',
          model: 'deepseek/deepseek-v4-flash',
          created: 1,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    fetchSpy.mockImplementationOnce(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('deadline reached', 'AbortError'));
          });
        })
    );

    try {
      const clients = createRuntimeBoundModelClients({
        runtimeSettings: Object.freeze({
          status: 'available' as const,
          effectiveModel: IntexAgentModels.DeepSeekV4Flash,
          explicitModel: IntexAgentModels.DeepSeekV4Flash,
          source: 'explicit' as const,
          revision: 1,
          timeZone: 'Europe/Warsaw',
        }),
        apiKey: 'platform-key',
        userId: 'user-1',
        logger: silentLogger(),
        usageSink: new FakeUsageSink() as never,
        timeoutMs: 100,
        deadlineAtMs: startedAtMs + 20,
        maxAttempts: 2,
      } as CreateRuntimeBoundModelClientsInput);

      await expect(
        clients.structuredClient.generate('Classify.', { promptType: 'matrix-classifier' })
      ).resolves.toMatchObject({ ok: true });

      const toolResultPromise = clients.toolCallingClient.run({
        systemPrompt: 'Respond.',
        messages: [{ role: 'user', content: 'Test.' }],
        tools: [],
        promptType: 'matrix-agent',
      });
      let settled = false;
      void toolResultPromise.finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(5);

      expect(settled).toBe(true);
      await expect(toolResultPromise).resolves.toMatchObject({
        ok: false,
        error: { code: 'TIMEOUT' },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      await vi.runAllTimersAsync();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not retry or substitute a model when product client construction fails', () => {
    const createToolCallingClientFn = vi.fn(() => {
      throw new Error('provider-construction-failed');
    });
    const createLlmClientFn = vi.fn(() => fakeStructuredClient());

    expect(() =>
      createRuntimeBoundModelClients({
        runtimeSettings: Object.freeze({
          status: 'unavailable',
          effectiveModel: IntexAgentModels.DeepSeekV4Flash,
          source: 'platform_default',
          timeZone: 'UTC',
        }),
        apiKey: 'platform-key',
        userId: 'user-1',
        logger: silentLogger(),
        usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
        createToolCallingClientFn,
        createLlmClientFn,
      })
    ).toThrow('provider-construction-failed');
    expect(createToolCallingClientFn).toHaveBeenCalledTimes(1);
    expect(createLlmClientFn).not.toHaveBeenCalled();
  });
});

describe('composeIntexAgentExecutionServices ordinary product isolation', () => {
  it.each<{
    name: string;
    catalogState: 'failed' | 'stale';
    runtime: IntexAgentRuntimeSettingsV1;
  }>([
    {
      name: 'failed catalog with explicit Gemini',
      catalogState: 'failed',
      runtime: {
        status: 'available',
        effectiveModel: IntexAgentModels.Gemini3FlashPreview,
        explicitModel: IntexAgentModels.Gemini3FlashPreview,
        source: 'explicit',
        revision: 3,
        timeZone: 'Europe/Warsaw',
      },
    },
    {
      name: 'stale catalog with default-absent DeepSeek',
      catalogState: 'stale',
      runtime: {
        status: 'available',
        effectiveModel: IntexAgentModels.DeepSeekV4Flash,
        explicitModel: null,
        source: 'default_absent',
        revision: 0,
        timeZone: 'UTC',
      },
    },
    {
      name: 'failed catalog with unavailable DeepSeek',
      catalogState: 'failed',
      runtime: {
        status: 'unavailable',
        effectiveModel: IntexAgentModels.DeepSeekV4Flash,
        source: 'platform_default',
        timeZone: 'America/New_York',
      },
    },
  ])(
    'keeps the actually composed app catalog out of ordinary turn: $name',
    async ({ catalogState, runtime }) => {
    const catalogClient = {
      getIntexAgentCatalogEvidence: vi.fn(async () => {
        if (catalogState === 'failed') throw new Error('catalog-failure-sentinel');
        return null;
      }),
    };
    const resolveRuntimeSettings = vi.fn(async () => ok(runtime));
    const toolFactory: NonNullable<
      CreateRuntimeBoundModelClientsInput['createToolCallingClientFn']
    > = vi.fn(() => ({ run: vi.fn() }) as never);
    const structuredFactory: NonNullable<
      CreateRuntimeBoundModelClientsInput['createLlmClientFn']
    > = vi.fn(() => ({ generate: vi.fn() }) as never);
    const runnerRun = vi.fn(
      async (input: Parameters<IntexAgentRunner['run']>[0]): Promise<IntexAgentRunnerResult> => {
        if (input.runtimeSettings === undefined) throw new Error('runtime snapshot missing');
        createRuntimeBoundModelClients({
          runtimeSettings: input.runtimeSettings,
          apiKey: 'platform-key',
          userId: input.session.userId,
          logger: silentLogger(),
          usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
          createToolCallingClientFn: toolFactory,
          createLlmClientFn: structuredFactory,
        });
        return { outcome: 'no_action', reply: 'Okay.' };
      }
    );
    const repository = new MemorySessionRepository();
    const appLogger = silentLogger();
    const createOrdinaryIncomingMessageHandler = vi.fn((_handlerLogger) => ({
      async handle(
        input: Parameters<typeof handleIncomingMessage>[0]
      ): ReturnType<typeof handleIncomingMessage> {
        return await handleIncomingMessage(input, {
          sessionRepository: repository,
          runner: {
            run: runnerRun,
            async executeConfirmed(): Promise<never> {
              throw new Error('not used');
            },
          },
          replyPublisher: { publishReply: () => Promise.resolve() },
          clock: { now: () => '2026-07-19T12:00:00.000Z' },
          resolveRuntimeSettings,
          logger: silentLogger(),
          ids: {
            sessionId: () => 'session-ordinary',
            eventId: () => `event-${String(repository.events.length + 1)}`,
            confirmationId: () => 'confirmation-unused',
          },
          sessionTimeoutMs: 30 * 60 * 1_000,
        });
      },
    }));
    const createTestConversationRunner = vi.fn(
      (_catalogClient: typeof catalogClient): TestConversationRunner => ({
        async run(): Promise<never> {
          throw new Error('evaluator not invoked');
        },
      })
    );
    const executionServices = composeIntexAgentExecutionServices({
      catalogClient,
      logger: appLogger,
      createOrdinaryIncomingMessageHandler,
      createTestConversationRunner,
    });

    await executionServices.incomingMessageHandler.handle({
      type: 'intex.message.ingest',
      userId: 'user-1',
      messageId: 'wamid-ordinary',
      text: 'hello',
      sourceType: 'whatsapp_text',
      timestamp: '2026-07-19T12:00:00.000Z',
    });

    expect(createOrdinaryIncomingMessageHandler).toHaveBeenCalledTimes(1);
    expect(createOrdinaryIncomingMessageHandler).toHaveBeenCalledWith(
      expect.objectContaining({ warn: expect.any(Function) })
    );
    expect(createOrdinaryIncomingMessageHandler.mock.calls[0]?.[0]).not.toBe(catalogClient);
    expect(createTestConversationRunner).toHaveBeenCalledWith(catalogClient);
    expect(resolveRuntimeSettings).toHaveBeenCalledTimes(1);
    expect(runnerRun).toHaveBeenCalledTimes(1);
    expect(toolFactory).toHaveBeenCalledTimes(1);
    expect(structuredFactory).toHaveBeenCalledTimes(1);
    expect(toolFactory).toHaveBeenCalledWith(
      expect.objectContaining({ model: runtime.effectiveModel })
    );
    expect(structuredFactory).toHaveBeenCalledWith(
      expect.objectContaining({ model: runtime.effectiveModel })
    );
    expect(catalogClient.getIntexAgentCatalogEvidence).not.toHaveBeenCalled();
    }
  );

  it('marks only the production handler delegate warning and leaks no runtime sentinel', async () => {
    const delegateWarn = vi.fn();
    const repository = new MemorySessionRepository();
    const rawSentinels = [
      'raw-resolver-user-sentinel',
      'https://private.invalid/runtime',
      'provider-sentinel',
      'model-sentinel',
      'resolver-cause-sentinel',
    ];
    const createOrdinaryIncomingMessageHandler = vi.fn((handlerLogger) => ({
      async handle(
        input: Parameters<typeof handleIncomingMessage>[0]
      ): ReturnType<typeof handleIncomingMessage> {
        return await handleIncomingMessage(input, {
          sessionRepository: repository,
          runner: {
            async run(): Promise<never> {
              throw new Error('runner must not execute');
            },
            async executeConfirmed(): Promise<never> {
              throw new Error('confirmed runner must not execute');
            },
          },
          replyPublisher: { publishReply: () => Promise.resolve() },
          clock: { now: () => '2026-07-19T12:00:00.000Z' },
          resolveRuntimeSettings: async () =>
            err({ code: 'API_ERROR', message: rawSentinels.join(' ') }),
          logger: handlerLogger,
          ids: {
            sessionId: () => 'session-sentry-boundary',
            eventId: () => `event-${String(repository.events.length + 1)}`,
            confirmationId: () => 'confirmation-unused',
          },
          sessionTimeoutMs: 30 * 60 * 1_000,
        });
      },
    }));
    const executionServices = composeIntexAgentExecutionServices({
      catalogClient: { getIntexAgentCatalogEvidence: vi.fn(async () => null) },
      logger: { warn: delegateWarn },
      createOrdinaryIncomingMessageHandler,
      createTestConversationRunner: () => ({
        async run(): Promise<never> {
          throw new Error('evaluator must not execute');
        },
      }),
    });

    await executionServices.incomingMessageHandler.handle({
      type: 'intex.message.ingest',
      userId: 'expected-owner-user',
      messageId: 'wamid-sentry-boundary',
      text: 'hello',
      sourceType: 'whatsapp_text',
      timestamp: '2026-07-19T12:00:00.000Z',
    });

    expect(delegateWarn).toHaveBeenCalledTimes(1);
    expect(delegateWarn).toHaveBeenCalledWith(
      {
        reason: 'runtime_settings_resolution_failed',
        [SKIP_SENTRY_KEY]: true,
      },
      'Intex Agent runtime settings resolution failed'
    );
    expect(JSON.stringify(delegateWarn.mock.calls)).not.toMatch(
      /expected-owner-user|raw-resolver-user-sentinel|private\.invalid|provider-sentinel|model-sentinel|resolver-cause-sentinel/iu
    );
  });
});

describe('createTestConversationRunnerService', () => {
  it('rejects omitted or mismatched models before catalog and provider access', async () => {
    const catalogClient = admittedCatalog();
    const createToolCallingClientFn = vi.fn(() => fakeToolCallingClient());
    const createLlmClientFn = vi.fn(() => fakeStructuredClient());
    const createAgentRunnerFn = noActionAgentFactory();
    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: new MemorySessionRepository(),
      promptPreferencesRepository: promptPreferencesRepository([]),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      catalogClient,
      createToolCallingClientFn,
      createLlmClientFn,
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });
    const base = testConversationRequest('model-boundary');

    for (const agentModel of [undefined, 'or:google/gemini-2.5-flash']) {
      await expect(
        runner.run({ ...base, agentModel } as unknown as Parameters<typeof runner.run>[0])
      ).rejects.toThrow('Intex Agent test conversation model mismatch');
    }

    expect(catalogClient.getIntexAgentCatalogEvidence).not.toHaveBeenCalled();
    expect(createToolCallingClientFn).not.toHaveBeenCalled();
    expect(createLlmClientFn).not.toHaveBeenCalled();
    expect(createAgentRunnerFn).not.toHaveBeenCalled();
  });

  it('wires real conversation flow with mocked tools and no downstream clients', async () => {
    const repository = new MemorySessionRepository();
    const promptPreferenceCalls: string[] = [];
    const toolCallingClient = fakeToolCallingClient();
    const structuredClient = fakeStructuredClient();
    const createToolCallingClientFn = vi.fn(() => toolCallingClient);
    const createLlmClientFn = vi.fn(() => structuredClient);
    const createAgentRunnerFn: AgentRunnerFactory = vi.fn((config): IntexAgentRunner => ({
      async run(): Promise<IntexAgentRunnerResult> {
        const rawResult = await config.toolExecutor.queryCalendarEvents({
          mode: 'list',
          timeMin: '2026-07-02T00:00:00+02:00',
          timeMax: '2026-07-03T00:00:00+02:00',
        });
        const toolResult = JSON.parse(rawResult) as Record<string, unknown>;
        return {
          outcome: 'completed',
          reply: `Calendar mock count: ${String(toolResult['count'])}`,
          toolName: 'query_calendar_events',
          toolResult,
        };
      },
      async executeConfirmed(): Promise<IntexAgentRunnerResult> {
        throw new Error('not used');
      },
    }));

    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: repository,
      promptPreferencesRepository: promptPreferencesRepository(promptPreferenceCalls),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      catalogClient: admittedCatalog(),
      createToolCallingClientFn,
      createLlmClientFn,
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });

    const result = await runner.run({
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      agentModel: 'or:deepseek/deepseek-v4-flash',
      userId: 'test-intex-agent-intex-e2e-services',
      runId: 'intex-e2e-services',
      currentDateTime: '2026-07-01T10:00:00.000Z',
      timeZone: 'UTC',
      turns: [
        {
          kind: 'message',
          text: 'Jakie wydarzenia jutro? intex-e2e-services',
        },
      ],
      toolMocks: {
        query_calendar_events: {
          mode: 'success',
          result: {
            status: 'completed',
            mode: 'list',
            count: 2,
            events: [{ summary: 'private event' }],
          },
        },
      },
    });

    expect(promptPreferenceCalls).toEqual(['test-intex-agent-intex-e2e-services']);
    expect(createToolCallingClientFn).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'openrouter-key',
        model: DEFAULT_INTEX_AGENT_MODEL,
        userId: 'test-intex-agent-intex-e2e-services',
      })
    );
    expect(createLlmClientFn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_INTEX_AGENT_MODEL,
        userId: 'test-intex-agent-intex-e2e-services',
      })
    );
    expect(createAgentRunnerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        client: toolCallingClient,
        responseRepairClient: structuredClient,
        intentClassifier: expect.anything(),
        toolExecutor: expect.anything(),
        userPreferences: [
          'rendered test preferences',
          'Use expectedVersion 0 for preference mutation tools.',
        ].join('\n'),
      })
    );
    expect(result.toolCalls).toEqual([
      {
        toolName: 'query_calendar_events',
        status: 'completed',
        argsSummary: {
          mode: 'list',
          timeMin: '2026-07-02T00:00:00+02:00',
          timeMax: '2026-07-03T00:00:00+02:00',
          syntheticMarkerCount: 0,
          syntheticMarkerDigest: markerDigest([]),
        },
        resultSummary: { status: 'completed', mode: 'list', count: 2 },
      },
    ]);
    expect(result.turns[0]?.assistantReplies[0]?.message).toBe('Calendar mock count: 2');
    expect(result.agentModel).toBe('or:deepseek/deepseek-v4-flash');
    expect(JSON.stringify(result)).not.toContain('private event');
  });

  it('keeps mocked failure details out of the full confirmed-execution response', async () => {
    const privateFailure =
      'delivery failed for private.person@example.com; secret=sk-private-value';
    const createAgentRunnerFn: AgentRunnerFactory = vi.fn((config): IntexAgentRunner => {
      const realRunner = createIntexAgentRunner(config);
      return {
        async run(): Promise<IntexAgentRunnerResult> {
          return {
            outcome: 'needs_confirmation',
            reply: 'Add this note?\nContent: private note body',
            toolName: 'create_note',
            toolArgs: { content: 'private note body' },
          };
        },
        async executeConfirmed(input): Promise<IntexAgentRunnerResult> {
          return await realRunner.executeConfirmed(input);
        },
      };
    });
    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: new MemorySessionRepository(),
      promptPreferencesRepository: promptPreferencesRepository([]),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      catalogClient: admittedCatalog(),
      createToolCallingClientFn: vi.fn(() => fakeToolCallingClient()),
      createLlmClientFn: vi.fn(() => fakeStructuredClient()),
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });

    const result = await runner.run({
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      agentModel: 'or:deepseek/deepseek-v4-flash',
      userId: 'test-intex-agent-private-tool-failure',
      runId: 'private-tool-failure',
      currentDateTime: '2026-07-01T10:00:00.000Z',
      timeZone: 'UTC',
      turns: [
        { kind: 'message', text: 'Save this note.' },
        { kind: 'confirmation_button', previousTurnIndex: 0, decision: 'accept' },
      ],
      toolMocks: {
        create_note: { mode: 'failure', message: privateFailure },
      },
    });

    expect(createAgentRunnerFn).toHaveBeenCalledTimes(2);
    expect(result.turns[1]?.assistantReplies[0]?.message).toBe(
      'I could not execute this action: tool_execution_failed. Please try again later.'
    );
    expect(result.turns[1]?.toolCalls).toEqual([
      {
        toolName: 'create_note',
        status: 'failed',
        argsSummary: {
          contentLength: 17,
          syntheticMarkerCount: 0,
          syntheticMarkerDigest: markerDigest([]),
        },
        error: 'tool_execution_failed',
      },
    ]);
    expect(result.behavioralTranscript.turns[1]?.toolOutcome).toEqual({
      toolName: 'create_note',
      status: 'failed',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private\.person@example\.com|sk-private-value|private note body/iu
    );
  });

  it('wires confirmed execution through mocked tools only', async () => {
    const repository = new MemorySessionRepository();
    const createAgentRunnerFn: AgentRunnerFactory = vi.fn((config): IntexAgentRunner => ({
      async run(): Promise<IntexAgentRunnerResult> {
        return {
          outcome: 'needs_confirmation',
          reply:
            'Add this note?\nContent: secret service test INTEX-EVAL-001 INTEX-EVAL-001-F01',
          toolName: 'create_note',
          toolArgs: {
            content: 'secret service test INTEX-EVAL-001 INTEX-EVAL-001-F01',
          },
        };
      },
      async executeConfirmed(): Promise<IntexAgentRunnerResult> {
        const rawResult = await config.toolExecutor.createNote({
          content: 'secret service test INTEX-EVAL-001 INTEX-EVAL-001-F01',
        });
        const toolResult = JSON.parse(rawResult) as Record<string, unknown>;
        return {
          outcome: 'completed',
          reply: `Confirmed note status: ${String(toolResult['status'])}`,
          toolName: 'create_note',
          toolResult,
        };
      },
    }));

    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: repository,
      promptPreferencesRepository: promptPreferencesRepository([]),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      catalogClient: admittedCatalog(),
      createToolCallingClientFn: vi.fn(() => fakeToolCallingClient()),
      createLlmClientFn: vi.fn(() => fakeStructuredClient()),
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });

    const result = await runner.run({
      contractVersion: '2026-07-01',
      mode: 'live_llm_mock_tools',
      agentModel: 'or:deepseek/deepseek-v4-flash',
      userId: 'test-intex-agent-intex-e2e-confirm-service',
      runId: 'intex-e2e-confirm-service',
      currentDateTime: '2026-07-01T10:00:00.000Z',
      timeZone: 'UTC',
      turns: [
        {
          kind: 'message',
          text: 'Save note INTEX-EVAL-001 INTEX-EVAL-001-F01 intex-e2e-confirm-service',
        },
        { kind: 'confirmation_button', previousTurnIndex: 0, decision: 'accept' },
      ],
      toolMocks: {
        create_note: {
          mode: 'success',
          result: { status: 'completed', resourceUrl: '/#/notes/mock-note' },
        },
      },
    });

    expect(createAgentRunnerFn).toHaveBeenCalledTimes(2);
    expect(result.turns[1]?.assistantReplies[0]?.message).toBe('Confirmed note status: completed');
    const expectedArgsSummary = {
      contentLength: 53,
      syntheticMarkerCount: 2,
      syntheticMarkerDigest: markerDigest(['INTEX-EVAL-001', 'INTEX-EVAL-001-F01']),
    };
    expect(result.toolCalls).toEqual([
      {
        toolName: 'create_note',
        status: 'completed',
        argsSummary: expectedArgsSummary,
        resultSummary: { status: 'completed' },
      },
    ]);
    const confirmationRequested = Object.values(result.eventsBySessionId)
      .flat()
      .find((event) => event.type === 'confirmation_requested');
    expect(confirmationRequested?.payload['argsSummary']).toEqual(expectedArgsSummary);
    expect(JSON.stringify(confirmationRequested?.payload)).not.toMatch(/secret service|INTEX-EVAL/iu);
    expect(JSON.stringify(result.toolCalls)).not.toMatch(/secret service|INTEX-EVAL/iu);
    expect(result.turns[0]?.submittedTextPreview).toContain('INTEX-EVAL-001-F01');
    const resultWithoutSubmittedText = {
      ...result,
      turns: result.turns.map(({ submittedTextPreview: _submittedTextPreview, ...turn }) => turn),
      behavioralTranscript: {
        turns: result.behavioralTranscript.turns.map(
          ({ submittedTextPreview: _submittedTextPreview, ...turn }) => turn
        ),
      },
    };
    expect(JSON.stringify(resultWithoutSubmittedText)).not.toContain('INTEX-EVAL');
    expect(JSON.stringify(result)).not.toContain('secret service test');
  });

  it('generates fresh deployed-mode ids for separate runs when ids are not injected', async () => {
    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: new MemorySessionRepository(),
      promptPreferencesRepository: promptPreferencesRepository([]),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      catalogClient: admittedCatalog(),
      createToolCallingClientFn: vi.fn(() => fakeToolCallingClient()),
      createLlmClientFn: vi.fn(() => fakeStructuredClient()),
      createAgentRunnerFn: vi.fn((): IntexAgentRunner => ({
        async run(): Promise<IntexAgentRunnerResult> {
          return { outcome: 'no_action', reply: 'Ready.' };
        },
        async executeConfirmed(): Promise<IntexAgentRunnerResult> {
          throw new Error('not used');
        },
      })),
    });

    const first = await runner.run(testRequest('fresh-one'));
    const second = await runner.run(testRequest('fresh-two'));

    expect(first.finalSessionId).toMatch(/^intex_session_/u);
    expect(second.finalSessionId).toMatch(/^intex_session_/u);
    expect(first.finalSessionId).not.toBe(second.finalSessionId);
    expect(first.eventsBySessionId[first.finalSessionId ?? '']?.[0]?.id).toMatch(/^intex_event_/u);
    expect(second.eventsBySessionId[second.finalSessionId ?? '']?.[0]?.id).toMatch(/^intex_event_/u);
  });

  it('passes an empty-but-versioned preference context to the runner', async () => {
    const repository = new MemorySessionRepository();
    const added = addPromptPreferenceItem(emptyPromptPreferences('user-versioned-empty'), {
      id: 'pref_focus',
      text: 'Prefer concise replies.',
      now: '2026-07-04T10:00:00.000Z',
      updatedBy: { actor: 'web_ui', userId: 'user-versioned-empty' },
    });
    const deleted = deletePromptPreferenceItem(added.current, {
      itemId: 'pref_focus',
      now: '2026-07-04T10:01:00.000Z',
      updatedBy: { actor: 'web_ui', userId: 'user-versioned-empty' },
    });
    const createAgentRunnerFn: AgentRunnerFactory = vi.fn((): IntexAgentRunner => ({
      async run(): Promise<IntexAgentRunnerResult> {
        return { outcome: 'no_action', reply: 'Ready.' };
      },
      async executeConfirmed(): Promise<IntexAgentRunnerResult> {
        throw new Error('not used');
      },
    }));

    const runner = createTestConversationRunnerService({
      config: testConfig(),
      sessionRepository: repository,
      promptPreferencesRepository: promptPreferencesRepositoryWithCurrent(deleted.current),
      logger: silentLogger(),
      usageSink: {} as CreateTestConversationRunnerServiceInput['usageSink'],
      catalogClient: admittedCatalog(),
      createToolCallingClientFn: vi.fn(() => fakeToolCallingClient()),
      createLlmClientFn: vi.fn(() => fakeStructuredClient()),
      createAgentRunnerFn,
      ids: fixedTestIds(),
    });

    await runner.run({
      ...testRequest('versioned-empty'),
      userId: 'user-versioned-empty',
    });

    expect(createAgentRunnerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        userPreferences: [
          'User Preferences v2:',
          'No active preference rows are currently defined.',
          'Use expectedVersion 2 for add_user_preference.',
        ].join('\n'),
      })
    );
  });
});

function testRequest(runId: string): Parameters<ReturnType<typeof createTestConversationRunnerService>['run']>[0] {
  return {
    contractVersion: '2026-07-01',
    mode: 'live_llm_mock_tools',
    agentModel: 'or:deepseek/deepseek-v4-flash',
    userId: `test-intex-agent-${runId}`,
    runId,
    currentDateTime: '2026-07-01T10:00:00.000Z',
    timeZone: 'UTC',
    turns: [{ kind: 'message', text: `Ping ${runId}` }],
  };
}

function markerDigest(markers: readonly string[]): string {
  return createHash('sha256')
    .update(`intex-eval-marker-set:v1\0${[...markers].sort().join('\n')}`, 'utf8')
    .digest('hex');
}

function testConfig(): CreateTestConversationRunnerServiceInput['config'] {
  return {
    port: 8080,
    host: '127.0.0.1',
    gcpProjectId: 'test-project',
    internalAuthToken: 'internal-token',
    userServiceUrl: 'http://user-service.test',
    notesAgentUrl: 'http://notes-agent.test',
    calendarAgentUrl: 'http://calendar-agent.test',
    researchAgentUrl: 'http://research-agent.test',
    bookmarksAgentUrl: 'http://bookmarks-agent.test',
    codeAgentUrl: 'http://code-agent.test',
    webAppUrl: 'https://intexuraos.cloud',
    llmUsageServiceUrl: 'http://llm-usage.test',
    openRouterAppApiKey: 'openrouter-key',
    whatsappSendTopic: 'whatsapp-send',
    sessionTimeoutMs: 30 * 60 * 1000,
    matrixCorpus: { enabled: false, runtimeAudience: 'disabled' },
    testRunsRead: { enabled: false },
  };
}

function catalogEvidence(): Awaited<
  ReturnType<CreateTestConversationRunnerServiceInput['catalogClient']['getIntexAgentCatalogEvidence']>
> {
  return {
    snapshotVersion: '2026-07-19',
    fetchedAt: '2026-07-19T12:00:00.000Z',
    models: [],
  };
}

function admittedCatalog(): CreateTestConversationRunnerServiceInput['catalogClient'] {
  return { getIntexAgentCatalogEvidence: vi.fn(async () => catalogEvidence()) };
}

function testConversationRequest(runId: string): Parameters<TestConversationRunner['run']>[0] {
  return {
    contractVersion: '2026-07-01',
    mode: 'live_llm_mock_tools',
    agentModel: 'or:deepseek/deepseek-v4-flash',
    userId: `test-intex-agent-${runId}`,
    runId,
    currentDateTime: '2026-07-01T10:00:00.000Z',
    timeZone: 'UTC',
    turns: [{ kind: 'message', text: 'hello' }],
    toolMocks: {},
  };
}

function noActionAgentFactory(): AgentRunnerFactory {
  return vi.fn((): IntexAgentRunner => ({
    async run(): Promise<IntexAgentRunnerResult> {
      return { outcome: 'no_action', reply: 'Ready.' };
    },
    async executeConfirmed(): Promise<IntexAgentRunnerResult> {
      throw new Error('not used');
    },
  }));
}

function catalogResponse(): Response {
  const supportedParameters = ['tools', 'tool_choice', 'response_format', 'structured_outputs'];
  return new Response(
    JSON.stringify({
      data: [
        {
          id: 'deepseek/deepseek-v4-flash',
          context_length: 1_048_576,
          pricing: {
            prompt: '0.000000098',
            completion: '0.000000196',
            input_cache_read: '0.0000000196',
          },
          architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          supported_parameters: supportedParameters,
        },
        {
          id: 'minimax/minimax-m3',
          context_length: 205_000,
          pricing: { prompt: '0.0000003', completion: '0.0000012' },
          architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          supported_parameters: supportedParameters,
        },
        {
          id: 'google/gemini-3-flash-preview',
          context_length: 1_000_000,
          pricing: { prompt: '0.0000003', completion: '0.0000025' },
          architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          supported_parameters: supportedParameters,
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function promptPreferencesRepository(
  calls: string[]
): CreateTestConversationRunnerServiceInput['promptPreferencesRepository'] {
  return {
    async getCurrent(userId: string): Promise<ReturnType<typeof emptyPromptPreferences>> {
      calls.push(userId);
      return { ...emptyPromptPreferences(userId), renderedPromptBlock: 'rendered test preferences' };
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

function promptPreferencesRepositoryWithCurrent(
  current: ReturnType<typeof emptyPromptPreferences>
): CreateTestConversationRunnerServiceInput['promptPreferencesRepository'] {
  return {
    async getCurrent(): Promise<ReturnType<typeof emptyPromptPreferences>> {
      return current;
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

function fakeToolCallingClient(): ReturnType<
  NonNullable<CreateTestConversationRunnerServiceInput['createToolCallingClientFn']>
> {
  return { run: vi.fn() } as ReturnType<
    NonNullable<CreateTestConversationRunnerServiceInput['createToolCallingClientFn']>
  >;
}

function emptyToolExecutor(
  overrides: Partial<IntexAgentToolExecutor> = {}
): IntexAgentToolExecutor {
  return {
    createNote: async () => 'note-1',
    createCalendarEvent: async () => 'event-1',
    queryCalendarEvents: async () => 'calendar-query-1',
    createResearch: async () => 'research-1',
    createLink: async () => 'bookmark-1',
    createCodeTask: async () => 'code-task-1',
    saveExternal: async () => 'external-save-1',
    getUserPreferences: async () => '{}',
    addUserPreference: async () => '{}',
    updateUserPreference: async () => '{}',
    deleteUserPreference: async () => '{}',
    ...overrides,
  };
}

function normalMatrixRunner(
  client: NonNullable<Parameters<typeof createMatrixCorpusRunner>[0]['client']>
): Readonly<{
  runner: ReturnType<typeof createMatrixCorpusRunner>;
  recordProviderCall: ReturnType<typeof vi.fn>;
}> {
  const recordProviderCall = vi.fn(async () => undefined);
  return {
    runner: createMatrixCorpusRunner({
      execution: {
        flow: 'normal',
        turnIndex: 0,
        ingestReceiptId: 'receipt_provider_usage',
        expectedSchedule: [],
        recordExecutionBoundary: vi.fn(async () => undefined),
        recordToolCallStarted: vi.fn(async () => undefined),
        registerExpectedProviderCall: vi.fn(),
        recordProviderCall,
      },
      client,
      intentClassifier: {
        async classify() {
          return { kind: 'no_action' as const, reason: 'conversation' as const };
        },
      },
      userPreferences: null,
    }),
    recordProviderCall,
  };
}

function fakeStructuredClient(): ReturnType<
  NonNullable<CreateTestConversationRunnerServiceInput['createLlmClientFn']>
> {
  return { generate: vi.fn() } as ReturnType<
    NonNullable<CreateTestConversationRunnerServiceInput['createLlmClientFn']>
  >;
}

function strictProfile(
  overrides: Partial<StrictToolMockProfileV1> = {}
): StrictToolMockProfileV1 {
  return {
    version: 1,
    calls: [],
    forbiddenSelections: [],
    unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
    ...overrides,
  };
}

function matrixCorpusSession(profile: StrictToolMockProfileV1): IntexAgentSession {
  return {
    id: 'matrix_session_1',
    userId: 'auth0:user_1',
    channel: 'whatsapp',
    status: 'active',
    startedAt: '2026-07-20T10:00:00.000Z',
    lastUserMessageAt: '2026-07-20T10:00:00.000Z',
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
      promptPreferencesVersion: 0,
      promptPreferencesDigest: 'a'.repeat(64),
      userTimeZone: 'Europe/Warsaw',
      mockProfile: profile,
      mockProfileDigest: createHash('sha256')
        .update(canonicalMatrixCorpusStrictToolMockProfileV1(profile), 'utf8')
        .digest('hex'),
      expectedToolSchedule: profile.calls.map(({ turnIndex, toolName, ordinal }) => ({
        turnIndex,
        toolName,
        ordinal,
      })),
    },
    lastEventSequence: 0,
  };
}

class MemorySessionRepository implements SessionRepository {
  readonly sessions: IntexAgentSession[] = [];
  readonly events: IntexAgentSessionEvent[] = [];

  async listSessions(userId: string): Promise<IntexAgentSession[]> {
    return this.sessions.filter((session) => session.userId === userId);
  }

  async getSession(sessionId: string, userId: string): Promise<IntexAgentSession | null> {
    return this.sessions.find((session) => session.id === sessionId && session.userId === userId) ?? null;
  }

  async listEvents(sessionId: string, userId: string): Promise<IntexAgentSessionEvent[]> {
    return this.events.filter((event) => event.sessionId === sessionId && event.userId === userId);
  }

  async findOpenSession(userId: string): Promise<IntexAgentSession | null> {
    return this.findContinuableSession(userId);
  }

  async findContinuableSession(userId: string): Promise<IntexAgentSession | null> {
    return (
      this.sessions
        .filter(
          (session) =>
            session.userId === userId &&
            ['active', 'waiting_for_user', 'executing_tool'].includes(session.status)
        )
        .sort((left, right) => left.lastUserMessageAt.localeCompare(right.lastUserMessageAt))
        .at(-1) ?? null
    );
  }

  async createSession(draft: IntexAgentSession): Promise<IntexAgentSession> {
    this.sessions.push(draft);
    return draft;
  }

  async updateSession(
    sessionId: string,
    update: SessionRepositorySessionUpdate
  ): Promise<IntexAgentSession> {
    const index = this.sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) {
      throw new Error(`Missing session ${sessionId}`);
    }
    const updated = { ...this.sessions[index], ...update } as IntexAgentSession;
    this.sessions[index] = updated;
    return updated;
  }

  async appendEvent(event: IntexAgentSessionEvent): Promise<void> {
    this.events.push(event);
  }
}

function fixedTestIds(): NonNullable<CreateTestConversationRunnerServiceInput['ids']> {
  let sequence = 0;
  return {
    sessionId: (): string => {
      sequence += 1;
      return `intex_session_test_${String(sequence)}`;
    },
    eventId: (): string => {
      sequence += 1;
      return `intex_event_test_${String(sequence)}`;
    },
    confirmationId: (): string => {
      sequence += 1;
      return `intex_confirmation_test_${String(sequence)}`;
    },
  };
}

function silentLogger(): CreateTestConversationRunnerServiceInput['logger'] {
  return {
    debug(): void {
      return undefined;
    },
    info(): void {
      return undefined;
    },
    warn(): void {
      return undefined;
    },
    error(): void {
      return undefined;
    },
  };
}
