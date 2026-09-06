import { createHash } from 'node:crypto';

import { err, ok } from '@intexuraos/common-core';
import type { StrictMockResultV1 } from '@intexuraos/http-contracts';
import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { IntexAgentModels } from '@intexuraos/llm-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  createMatrixCorpusContextCrypto,
  type MatrixCorpusContextCrypto,
} from '../../../domain/matrixCorpus/contextCrypto.js';
import {
  createMatrixCorpusContextService,
  type MatrixCorpusContextService,
  type MatrixCorpusContextServiceDeps,
  type MatrixCorpusRunContextRegistrationInput,
} from '../../../domain/matrixCorpus/contextService.js';
import type { IntexAgentPromptPreferences } from '../../../domain/preferences/promptPreferences.js';
import { matrixCorpusPreferenceMutationReceipt } from '../../../domain/matrixCorpus/strictToolMockExecutor.js';
import { FirestoreMatrixCorpusContextRepository } from '../../../infra/firestore/matrixCorpusContextRepository.js';
import { FirestoreMatrixCorpusManifestRepository } from '../../../infra/firestore/matrixCorpusManifestRepository.js';

const now = '2026-07-20T10:00:00.000Z';
const expiresAt = '2026-07-21T10:00:00.000Z';
const privatePreference = 'Odpowiadaj krótko i pamiętaj o szczupakach.';
const syntheticPreferenceId = 'mock_pref_699cdd9a0f11f761f0d942be';

type TestOverlayMutation = Readonly<{
  mutationReceipt: string;
  argsDigest: string;
  toolName: 'add_user_preference' | 'update_user_preference' | 'delete_user_preference';
  turnIndex: number;
  ordinal: number;
  result: StrictMockResultV1;
}>;

type TestPreferenceOverlay = Readonly<{
  version: 1;
  currentVersion: number;
  items: readonly Readonly<{ id: string; text: string }>[];
  mutations: readonly TestOverlayMutation[];
}>;

type TestPromptPayload = Readonly<{
  version: 1;
  userPreferences: string | null;
  preferenceOverlay: TestPreferenceOverlay;
}>;

function preferences(): IntexAgentPromptPreferences {
  return {
    userId: 'auth0:user_1',
    schemaVersion: 1,
    currentVersion: 2,
    items: [
      {
        id: 'pref_1',
        text: privatePreference,
        createdAt: now,
        updatedAt: now,
      },
    ],
    renderedPromptBlock: `User Preferences v2:\n1. (id: pref_1) "${privatePreference}"`,
    createdAt: now,
    updatedAt: now,
    updatedBy: { actor: 'web_ui', userId: 'auth0:user_1' },
  };
}

function registration(
  overrides: Readonly<Record<string, unknown>> = {}
): MatrixCorpusRunContextRegistrationInput {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'auth0:user_1',
    leaseFence: '7',
    catalogDigest: 'a'.repeat(64),
    agentModel: 'or:deepseek/deepseek-v4-flash' as const,
    evaluatorModel: 'or:minimax/minimax-m3' as const,
    expectedTimeZone: 'Europe/Warsaw',
    ...overrides,
  };
}

function fixture(): Readonly<{
  firestore: Firestore;
  contextRepository: FirestoreMatrixCorpusContextRepository;
  manifestRepository: FirestoreMatrixCorpusManifestRepository;
  promptPreferencesRepository: MatrixCorpusContextServiceDeps['promptPreferencesRepository'] &
    Readonly<{ getCurrent: ReturnType<typeof vi.fn> }>;
  runtimeSettingsClient: MatrixCorpusContextServiceDeps['runtimeSettingsClient'] &
    Readonly<{ resolveIntexAgentRuntimeSettings: ReturnType<typeof vi.fn> }>;
  crypto: MatrixCorpusContextCrypto;
  service: MatrixCorpusContextService;
}> {
  const firestore = createFakeFirestore() as unknown as Firestore;
  const contextRepository = new FirestoreMatrixCorpusContextRepository({ firestore });
  const manifestRepository = new FirestoreMatrixCorpusManifestRepository({ firestore });
  const promptPreferencesRepository = {
    getCurrent: vi.fn(async () => preferences()),
  };
  const runtimeSettingsClient = {
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
  };
  const crypto = createMatrixCorpusContextCrypto({
    key: Buffer.alloc(32, 7),
    keyVersion: 'context-key-v1',
    randomBytes: () => Buffer.alloc(12, 3),
  });
  const service = createMatrixCorpusContextService({
    contextRepository,
    manifestRepository,
    promptPreferencesRepository,
    runtimeSettingsClient,
    crypto,
    now: () => now,
  });
  return {
    firestore,
    contextRepository,
    manifestRepository,
    promptPreferencesRepository,
    runtimeSettingsClient,
    crypto,
    service,
  };
}

async function preferenceOverlayFixture(): Promise<
  ReturnType<typeof fixture> &
    Readonly<{
      identity: Parameters<MatrixCorpusContextService['registerScenario']>[0];
      overlay: ReturnType<MatrixCorpusContextService['createPreferenceOverlay']>;
    }>
> {
  const current = fixture();
  await current.service.registerRun(registration());
  const identity = {
    runId: 'run_1',
    scenarioId: 'scenario_001',
    userId: 'auth0:user_1',
    leaseFence: '7',
  } as const;
  await current.service.registerScenario(identity);
  return {
    ...current,
    identity,
    overlay: current.service.createPreferenceOverlay(identity),
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function renderTestOverlay(overlay: TestPreferenceOverlay): string {
  return [
    `User Preferences v${String(overlay.currentVersion)}:`,
    ...overlay.items.map(
      (item, index) => `${String(index + 1)}. (id: ${item.id}) ${JSON.stringify(item.text)}`
    ),
    `Use expectedVersion ${String(overlay.currentVersion)} for preference mutation tools.`,
  ].join('\n');
}

async function replaceLoadedOverlay(
  current: Awaited<ReturnType<typeof preferenceOverlayFixture>>,
  overlay: TestPreferenceOverlay,
  userPreferences = renderTestOverlay(overlay)
): Promise<void> {
  const stored = await current.contextRepository.getScenarioContext({
    ...current.identity,
    now,
  });
  if (!stored.ok) throw new Error('scenario context missing');
  const payload: TestPromptPayload = {
    version: 1,
    userPreferences,
    preferenceOverlay: overlay,
  };
  const context = {
    ...stored.context,
    overlayVersion: overlay.mutations.length,
    overlayDigest: sha256(stableJson(overlay)),
    encryptedEffectivePromptContext: current.crypto.encrypt(JSON.stringify(payload), {
      version: 1,
      kind: 'scenario_prompt_context',
      runtimeAudience: 'hetzner-prod',
      ...current.identity,
    }),
  };
  vi.spyOn(current.contextRepository, 'getScenarioContext').mockResolvedValue({
    ok: true,
    context,
  });
}

describe('Matrix corpus context service', () => {
  it.each([
    ['wrong audience', { runtimeAudience: 'production' }],
    ['empty run id', { runId: '' }],
    ['empty user id', { userId: '' }],
    ['zero fence', { leaseFence: '0' }],
    ['invalid catalog digest', { catalogDigest: 'invalid' }],
  ])('rejects invalid registration field: %s', async (_name, overrides) => {
    const { service, contextRepository, runtimeSettingsClient } = fixture();
    await expect(service.registerRun(registration(overrides))).resolves.toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(runtimeSettingsClient.resolveIntexAgentRuntimeSettings).not.toHaveBeenCalled();
    await expect(
      contextRepository.getRunContext({
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        now,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('rejects a non-timestamp service clock before any external settings read', async () => {
    const base = fixture();
    const service = createMatrixCorpusContextService({
      contextRepository: base.contextRepository,
      manifestRepository: base.manifestRepository,
      promptPreferencesRepository: base.promptPreferencesRepository,
      runtimeSettingsClient: base.runtimeSettingsClient,
      crypto: base.crypto,
      now: () => 'invalid',
    });

    await expect(service.registerRun(registration())).resolves.toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(base.runtimeSettingsClient.resolveIntexAgentRuntimeSettings).not.toHaveBeenCalled();
  });

  it('snapshots runtime settings and rendered preferences once, encrypts them, and creates the manifest', async () => {
    const {
      service,
      contextRepository,
      manifestRepository,
      promptPreferencesRepository,
      runtimeSettingsClient,
      crypto,
    } = fixture();

    const result = await service.registerRun(registration());

    expect(result).toEqual({
      ok: true,
      disposition: 'applied',
      snapshot: {
        promptPreferencesVersion: 2,
        promptPreferencesDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        agentModel: 'or:deepseek/deepseek-v4-flash',
        userTimeZone: 'Europe/Warsaw',
        expiresAt,
      },
    });
    expect(promptPreferencesRepository.getCurrent).toHaveBeenCalledOnce();
    expect(promptPreferencesRepository.getCurrent).toHaveBeenCalledWith('auth0:user_1');
    expect(runtimeSettingsClient.resolveIntexAgentRuntimeSettings).toHaveBeenCalledOnce();
    expect(runtimeSettingsClient.resolveIntexAgentRuntimeSettings).toHaveBeenCalledWith(
      'auth0:user_1'
    );

    const stored = await contextRepository.getRunContext({
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
      now,
    });
    if (!stored.ok || stored.context.status !== 'active') throw new Error('context missing');
    expect(
      JSON.parse(
        crypto.decrypt(stored.context.encryptedPromptContext, {
          version: 1,
          kind: 'run_prompt_context',
          runtimeAudience: 'hetzner-prod',
          runId: 'run_1',
          userId: 'auth0:user_1',
          leaseFence: '7',
        })
      )
    ).toEqual({
      version: 1,
      userPreferences: `User Preferences v2:\n1. (id: ${syntheticPreferenceId}) "${privatePreference}"\nUse expectedVersion 2 for preference mutation tools.`,
      preferenceOverlay: {
        version: 1,
        currentVersion: 2,
        items: [{ id: syntheticPreferenceId, text: privatePreference }],
        mutations: [],
      },
    });
    await expect(
      manifestRepository.getExact({
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toMatchObject({
      ok: true,
      manifest: { catalogDigest: 'a'.repeat(64), scenarioBindings: [] },
    });
    expect(JSON.stringify(result)).not.toContain(privatePreference);
  });

  it('registers MiniMax M3 when the immutable run request matches effective runtime settings', async () => {
    const current = fixture();
    current.runtimeSettingsClient.resolveIntexAgentRuntimeSettings.mockResolvedValue(
      ok({
        status: 'available' as const,
        effectiveModel: IntexAgentModels.MiniMaxM3,
        explicitModel: IntexAgentModels.MiniMaxM3,
        source: 'explicit' as const,
        revision: 1,
        timeZone: 'Europe/Warsaw',
      })
    );

    const result = await current.service.registerRun(
      registration({ agentModel: 'or:minimax/minimax-m3' })
    );

    expect(result).toMatchObject({
      ok: true,
      snapshot: { agentModel: 'or:minimax/minimax-m3' },
    });
  });

  it('starts preference-mutation scenarios from an isolated pristine overlay', async () => {
    const current = fixture();
    await current.service.registerRun(registration());
    const identity = {
      runId: 'run_1',
      scenarioId: 'scenario_preference_mutation',
      userId: 'auth0:user_1',
      leaseFence: '7',
    } as const;

    await expect(
      current.service.registerScenario({
        ...identity,
        preferenceOverlayMode: 'pristine_v0',
      })
    ).resolves.toMatchObject({
      ok: true,
      disposition: 'applied',
      snapshot: { overlayVersion: 0 },
    });
    await expect(current.service.loadScenarioPromptContext(identity)).resolves.toMatchObject({
      ok: true,
      promptContext: '{"version":1,"userPreferences":null}',
      overlayVersion: 0,
    });

    const overlay = current.service.createPreferenceOverlay(identity);
    await expect(
      overlay.read({
        ingestReceiptId: 'receipt_read_pristine',
        toolName: 'get_user_preferences',
        turnIndex: 0,
        ordinal: 1,
        configuredResult: {
          toolName: 'get_user_preferences',
          status: 'completed',
          currentVersion: 99,
          items: [],
        },
      })
    ).resolves.toEqual({
      toolName: 'get_user_preferences',
      status: 'completed',
      currentVersion: 0,
      items: [],
    });
  });

  it('replays an exact registration without rereading user data and rejects changed reuse', async () => {
    const { service, promptPreferencesRepository, runtimeSettingsClient } = fixture();
    const first = await service.registerRun(registration());
    const replay = await service.registerRun(registration());

    expect(first).toMatchObject({ ok: true, disposition: 'applied' });
    expect(replay).toMatchObject({ ok: true, disposition: 'already_applied' });
    expect(promptPreferencesRepository.getCurrent).toHaveBeenCalledOnce();
    expect(runtimeSettingsClient.resolveIntexAgentRuntimeSettings).toHaveBeenCalledOnce();
    await expect(
      service.registerRun(registration({ catalogDigest: 'd'.repeat(64) }))
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    await expect(
      service.registerRun(registration({ agentModel: 'or:minimax/minimax-m3' }))
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    expect(promptPreferencesRepository.getCurrent).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'wrong requested agent model',
      { agentModel: 'or:google/gemini-3.6-flash' },
      undefined,
    ],
    ['wrong evaluator model', { evaluatorModel: 'or:google/gemini-3.6-flash' }, undefined],
    ['wrong expected time zone', { expectedTimeZone: 'UTC' }, undefined],
    [
      'unavailable runtime',
      {},
      ok({
        status: 'unavailable' as const,
        effectiveModel: IntexAgentModels.DeepSeekV4Flash,
        source: 'platform_default' as const,
        timeZone: 'Europe/Warsaw',
      }),
    ],
    [
      'runtime model mismatch',
      {},
      ok({
        status: 'available' as const,
        effectiveModel: IntexAgentModels.MiniMaxM3,
        explicitModel: IntexAgentModels.MiniMaxM3,
        source: 'explicit' as const,
        revision: 1,
        timeZone: 'Europe/Warsaw',
      }),
    ],
    [
      'runtime timezone mismatch',
      {},
      ok({
        status: 'available' as const,
        effectiveModel: IntexAgentModels.DeepSeekV4Flash,
        explicitModel: null,
        source: 'default_absent' as const,
        revision: 0,
        timeZone: 'UTC',
      }),
    ],
    [
      'runtime lookup failure',
      {},
      err({ code: 'TIMEOUT' as const, message: 'private failure' }),
    ],
  ])('fails closed for %s without persisting context', async (_name, overrides, runtimeResult) => {
    const { service, runtimeSettingsClient, contextRepository } = fixture();
    if (runtimeResult !== undefined)
      runtimeSettingsClient.resolveIntexAgentRuntimeSettings.mockResolvedValue(runtimeResult as never);

    await expect(service.registerRun(registration(overrides))).resolves.toMatchObject({
      ok: false,
    });
    await expect(
      contextRepository.getRunContext({
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        now,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it.each([
    ['missing preferences', undefined],
    ['foreign preferences', { ...preferences(), userId: 'auth0:other' }],
    ['fractional version', { ...preferences(), currentVersion: 1.5 }],
    ['negative version', { ...preferences(), currentVersion: -1 }],
    [
      'invalid preference text',
      {
        ...preferences(),
        items: [{ ...preferences().items[0], text: '   ' }],
      },
    ],
  ])('rejects %s without persisting encrypted context', async (_name, value) => {
    const { service, promptPreferencesRepository, contextRepository } = fixture();
    promptPreferencesRepository.getCurrent.mockResolvedValue(value as never);

    await expect(service.registerRun(registration())).resolves.toEqual({
      ok: false,
      code: 'PROMPT_PREFERENCES_INVALID',
    });
    await expect(
      contextRepository.getRunContext({
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
        now,
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it.each([
    [0, null],
    [2, 'No active preference rows are currently defined.'],
  ] as const)('renders an empty preference overlay at version %i', async (currentVersion, expected) => {
    const { service, promptPreferencesRepository } = fixture();
    promptPreferencesRepository.getCurrent.mockResolvedValue({
      ...preferences(),
      currentVersion,
      items: [],
      renderedPromptBlock: '',
      createdAt: currentVersion === 0 ? null : now,
    });

    await expect(service.registerRun(registration())).resolves.toMatchObject({ ok: true });
    await expect(
      service.registerScenario({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toMatchObject({ ok: true });
    const loaded = await service.loadScenarioPromptContext({
      runId: 'run_1',
      scenarioId: 'scenario_001',
      userId: 'auth0:user_1',
      leaseFence: '7',
    });
    expect(loaded).toMatchObject({ ok: true });
    if (loaded.ok) {
      if (expected === null) {
        expect(loaded.promptContext).toContain('"userPreferences":null');
      } else {
        expect(loaded.promptContext).toContain(expected);
      }
    }
  });

  it('closes registration and profile reads after atomic run finalization', async () => {
    const { service } = fixture();
    await service.registerRun(registration());
    await expect(
      service.finalizeRun({ runId: 'run_1', userId: 'auth0:user_1', leaseFence: '7' })
    ).resolves.toMatchObject({ ok: true });
    await expect(service.registerRun(registration())).resolves.toEqual({
      ok: false,
      code: 'FINALIZED',
    });
    await expect(
      service.loadSessionProfileSnapshot({
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toEqual({ ok: false, code: 'FINALIZED' });
  });

  it('creates each scenario from the immutable baseline and loads only exact live context', async () => {
    const { service } = fixture();
    await service.registerRun(registration());

    await expect(
      service.loadSessionProfileSnapshot({
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toEqual({
      ok: true,
      snapshot: {
        promptPreferencesVersion: 2,
        promptPreferencesDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        agentModel: 'or:deepseek/deepseek-v4-flash',
        evaluatorModel: 'or:minimax/minimax-m3',
        userTimeZone: 'Europe/Warsaw',
      },
    });

    await expect(
      service.registerScenario({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toEqual({
      ok: true,
      disposition: 'applied',
      snapshot: {
        baselinePromptPreferencesDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        overlayVersion: 0,
        overlayDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        expiresAt,
      },
    });
    await expect(
      service.loadScenarioPromptContext({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toEqual({
      ok: true,
      promptContext: JSON.stringify({
        version: 1,
        userPreferences: `User Preferences v2:\n1. (id: ${syntheticPreferenceId}) "${privatePreference}"\nUse expectedVersion 2 for preference mutation tools.`,
      }),
      overlayVersion: 0,
      overlayDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    await expect(
      service.loadScenarioPromptContext({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
        leaseFence: '8',
      })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
    await expect(
      service.loadSessionProfileSnapshot({
        runId: 'run_1',
        userId: 'auth0:user_1',
        leaseFence: '8',
      })
    ).resolves.toEqual({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' });
  });

  it('applies preference mocks only to the encrypted scenario overlay with exact retry receipts', async () => {
    const { service, promptPreferencesRepository } = fixture();
    await service.registerRun(registration());
    const identity = {
      runId: 'run_1',
      scenarioId: 'scenario_001',
      userId: 'auth0:user_1',
      leaseFence: '7',
    };
    await service.registerScenario(identity);
    const overlay = service.createPreferenceOverlay(identity);
    const initial = {
      toolName: 'get_user_preferences' as const,
      status: 'completed' as const,
      currentVersion: 2,
      items: [{ id: syntheticPreferenceId, text: privatePreference }],
    };

    await expect(
      overlay.read({
        ingestReceiptId: 'receipt_read',
        toolName: 'get_user_preferences',
        turnIndex: 0,
        ordinal: 1,
        configuredResult: initial,
      })
    ).resolves.toEqual(initial);

    const updated = {
      toolName: 'update_user_preference' as const,
      status: 'completed' as const,
      currentVersion: 3,
      changedItemId: syntheticPreferenceId,
    };
    const updateRequest = {
      ingestReceiptId: 'receipt_update',
      mutationReceipt: matrixCorpusPreferenceMutationReceipt(
        'receipt_update',
        'update_user_preference',
        0,
        1
      ),
      toolName: 'update_user_preference' as const,
      turnIndex: 0,
      ordinal: 1,
      args: {
        itemId: syntheticPreferenceId,
        text: 'Odpowiadaj bardzo krótko.',
        expectedVersion: 2,
      },
      configuredResult: updated,
    };
    await expect(overlay.mutate(updateRequest)).resolves.toEqual(updated);

    const added = {
      toolName: 'add_user_preference' as const,
      status: 'completed' as const,
      currentVersion: 4,
      changedItemId: 'mock_pref_added',
    };
    await expect(
      overlay.mutate({
        ingestReceiptId: 'receipt_add',
        mutationReceipt: matrixCorpusPreferenceMutationReceipt(
          'receipt_add',
          'add_user_preference',
          1,
          1
        ),
        toolName: 'add_user_preference',
        turnIndex: 1,
        ordinal: 1,
        args: { text: 'Bez emoji.', expectedVersion: 3 },
        configuredResult: added,
      })
    ).resolves.toEqual(added);

    const deleted = {
      toolName: 'delete_user_preference' as const,
      status: 'completed' as const,
      currentVersion: 5,
      changedItemId: 'mock_pref_added',
    };
    await expect(
      overlay.mutate({
        ingestReceiptId: 'receipt_delete',
        mutationReceipt: matrixCorpusPreferenceMutationReceipt(
          'receipt_delete',
          'delete_user_preference',
          2,
          1
        ),
        toolName: 'delete_user_preference',
        turnIndex: 2,
        ordinal: 1,
        args: { itemId: 'mock_pref_added', expectedVersion: 4 },
        configuredResult: deleted,
      })
    ).resolves.toEqual(deleted);

    await expect(overlay.mutate(updateRequest)).resolves.toEqual(updated);
    const finalRead = {
      toolName: 'get_user_preferences' as const,
      status: 'completed' as const,
      currentVersion: 5,
      items: [{ id: syntheticPreferenceId, text: 'Odpowiadaj bardzo krótko.' }],
    };
    await expect(
      overlay.read({
        ingestReceiptId: 'receipt_final_read',
        toolName: 'get_user_preferences',
        turnIndex: 3,
        ordinal: 1,
        configuredResult: finalRead,
      })
    ).resolves.toEqual(finalRead);

    await expect(
      overlay.mutate({
        ...updateRequest,
        mutationReceipt: matrixCorpusPreferenceMutationReceipt(
          'receipt_update',
          'update_user_preference',
          4,
          1
        ),
        turnIndex: 4,
        args: {
          itemId: syntheticPreferenceId,
          text: 'Odpowiadaj bardzo krótko.',
          expectedVersion: 5,
        },
        configuredResult: { ...updated, currentVersion: 6 },
      })
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });
    await expect(service.loadScenarioPromptContext(identity)).resolves.toMatchObject({
      ok: true,
      overlayVersion: 3,
      promptContext: expect.stringContaining('Odpowiadaj bardzo krótko.'),
    });
    expect(promptPreferencesRepository.getCurrent).toHaveBeenCalledOnce();
  });

  it.each([
    {
      toolName: 'update_user_preference',
      scenarioId: 'intex-eval-018',
      inputItemId: 'pref_INTEX-EVAL-018-F01',
      changedItemId: 'mock_pref_intex_eval_018_1',
    },
    {
      toolName: 'delete_user_preference',
      scenarioId: 'intex-eval-019',
      inputItemId: 'pref_INTEX-EVAL-019_INTEX-EVAL-019-F01',
      changedItemId: 'mock_pref_intex_eval_019_1',
    },
  ] as const)(
    'maps the exact $scenarioId input identifier to the signed pristine-overlay result',
    async ({ changedItemId, inputItemId, scenarioId, toolName }) => {
      const current = fixture();
      await current.service.registerRun(registration());
      const identity = {
        runId: 'run_1',
        scenarioId,
        userId: 'auth0:user_1',
        leaseFence: '7',
      } as const;
      await current.service.registerScenario({
        ...identity,
        preferenceOverlayMode: 'pristine_v0',
      });
      const overlay = current.service.createPreferenceOverlay(identity);
      const ingestReceiptId = `receipt_${toolName}`;
      const configuredResult = {
        toolName,
        status: 'completed' as const,
        currentVersion: 1,
        changedItemId,
      };

      await expect(
        overlay.mutate({
          ingestReceiptId,
          mutationReceipt: matrixCorpusPreferenceMutationReceipt(
            ingestReceiptId,
            toolName,
            0,
            1
          ),
          toolName,
          turnIndex: 0,
          ordinal: 1,
          args:
            toolName === 'update_user_preference'
              ? { itemId: inputItemId, text: 'Synthetic replacement.', expectedVersion: 0 }
              : { itemId: inputItemId, expectedVersion: 0 },
          configuredResult,
        })
      ).resolves.toEqual(configuredResult);
    }
  );

  it('maps tampering and expiry to static closed failures without leaking ciphertext', async () => {
    const { service, firestore } = fixture();
    await service.registerRun(registration());
    await service.registerScenario({
      runId: 'run_1',
      scenarioId: 'scenario_001',
      userId: 'auth0:user_1',
      leaseFence: '7',
    });
    const scenarios = await firestore
      .collection('intex_agent_matrix_corpus_scenario_contexts')
      .where('scenarioId', '==', 'scenario_001')
      .get();
    const document = scenarios.docs[0];
    if (document === undefined) throw new Error('scenario fixture missing');
    const data = document.data();
    await document.ref.set({
      ...data,
      encryptedEffectivePromptContext: {
        ...(data['encryptedEffectivePromptContext'] as Record<string, unknown>),
        authenticationTag: 'A'.repeat(22),
      },
    });

    const tampered = await service.loadScenarioPromptContext({
      runId: 'run_1',
      scenarioId: 'scenario_001',
      userId: 'auth0:user_1',
      leaseFence: '7',
    });
    expect(tampered).toEqual({ ok: false, code: 'CONTEXT_DECRYPTION_FAILED' });
    expect(JSON.stringify(tampered)).not.toContain('authenticationTag');
  });

  it('rejects invalid scenario/profile identities and absent scenario context', async () => {
    const { service } = fixture();
    await expect(
      service.registerScenario({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
        leaseFence: '7',
        preferenceOverlayMode: 'invalid' as 'pristine_v0',
      })
    ).resolves.toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    for (const identity of [
      { runId: '', scenarioId: 'scenario_001', userId: 'auth0:user_1', leaseFence: '7' },
      { runId: 'run_1', scenarioId: '', userId: 'auth0:user_1', leaseFence: '7' },
      { runId: 'run_1', scenarioId: 'scenario_001', userId: '', leaseFence: '7' },
      { runId: 'run_1', scenarioId: 'scenario_001', userId: 'auth0:user_1', leaseFence: '0' },
    ]) {
      await expect(service.registerScenario(identity)).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      await expect(service.loadScenarioPromptContext(identity)).resolves.toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
    }
    await expect(
      service.loadSessionProfileSnapshot({ runId: '', userId: 'auth0:user_1', leaseFence: '7' })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
    await expect(
      service.loadScenarioPromptContext({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(() =>
      service.createPreferenceOverlay({
        runId: 'run_1',
        scenarioId: '',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).toThrowError(expect.objectContaining({ code: 'PREFERENCE_OVERLAY_REJECTED' }));
  });

  it.each([
    ['EXPIRED', 'EXPIRED'],
    ['INVALIDATED', 'INVALIDATED'],
    ['CORRUPT_CONTEXT', 'CONTEXT_PERSISTENCE_FAILED'],
    ['MANIFEST_MISMATCH', 'CONTEXT_PERSISTENCE_FAILED'],
  ] as const)('maps a %s run-context read failure to %s', async (repositoryCode, serviceCode) => {
    const current = fixture();
    vi.spyOn(current.contextRepository, 'getRunContext').mockResolvedValueOnce({
      ok: false,
      code: repositoryCode,
    });

    await expect(current.service.registerRun(registration())).resolves.toEqual({
      ok: false,
      code: serviceCode,
    });
  });

  it('fails closed when exact registration repair cannot restore the manifest', async () => {
    const current = fixture();
    await current.service.registerRun(registration());
    vi.spyOn(current.contextRepository, 'registerRunContextAndManifest').mockResolvedValueOnce({
      ok: false,
      code: 'MANIFEST_MISMATCH',
    });

    await expect(current.service.registerRun(registration())).resolves.toEqual({
      ok: false,
      code: 'CONTEXT_PERSISTENCE_FAILED',
    });
  });

  it('accepts only the exact winner of a concurrent run registration', async () => {
    const seed = fixture();
    await seed.service.registerRun(registration());
    const stored = await seed.contextRepository.getRunContext({
      ...registration(),
      now,
    });
    if (!stored.ok) throw new Error('seed run context missing');

    const accepted = fixture();
    vi.spyOn(accepted.contextRepository, 'getRunContext')
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockResolvedValueOnce(stored);
    vi.spyOn(accepted.contextRepository, 'registerRunContextAndManifest')
      .mockResolvedValueOnce({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' })
      .mockResolvedValueOnce({
        ok: true,
        disposition: 'already_applied',
        context: stored.context,
      });
    await expect(accepted.service.registerRun(registration())).resolves.toMatchObject({
      ok: true,
      disposition: 'already_applied',
    });

    for (const raced of [
      { ok: false, code: 'NOT_FOUND' },
      { ok: true, context: { ...stored.context, status: 'finalized' } },
      { ok: true, context: { ...stored.context, catalogDigest: 'b'.repeat(64) } },
    ] as const) {
      const rejected = fixture();
      vi.spyOn(rejected.contextRepository, 'getRunContext')
        .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
        .mockResolvedValueOnce(raced as never);
      vi.spyOn(rejected.contextRepository, 'registerRunContextAndManifest').mockResolvedValueOnce({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
      await expect(rejected.service.registerRun(registration())).resolves.toEqual({
        ok: false,
        code: 'CORRELATED_REPLAY_CONFLICT',
      });
    }

    const repairRejected = fixture();
    vi.spyOn(repairRejected.contextRepository, 'getRunContext')
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockResolvedValueOnce(stored);
    vi.spyOn(repairRejected.contextRepository, 'registerRunContextAndManifest')
      .mockResolvedValueOnce({ ok: false, code: 'CORRELATED_REPLAY_CONFLICT' })
      .mockResolvedValueOnce({ ok: false, code: 'MANIFEST_MISMATCH' });
    await expect(repairRejected.service.registerRun(registration())).resolves.toEqual({
      ok: false,
      code: 'CONTEXT_PERSISTENCE_FAILED',
    });
  });

  it('maps scenario registration persistence failures and finalized run state', async () => {
    const persistence = fixture();
    await persistence.service.registerRun(registration());
    vi.spyOn(persistence.contextRepository, 'registerScenarioContext').mockResolvedValueOnce({
      ok: false,
      code: 'CORRUPT_CONTEXT',
    });
    await expect(
      persistence.service.registerScenario({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toEqual({ ok: false, code: 'CONTEXT_PERSISTENCE_FAILED' });

    const finalized = fixture();
    await finalized.service.registerRun(registration());
    await finalized.service.finalizeRun({
      runId: 'run_1',
      userId: 'auth0:user_1',
      leaseFence: '7',
    });
    await expect(
      finalized.service.registerScenario({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toEqual({ ok: false, code: 'FINALIZED' });
  });

  it('rejects generic malformed decrypted run context during scenario registration', async () => {
    const current = fixture();
    await current.service.registerRun(registration());
    const crypto = {
      ...current.crypto,
      decrypt: vi.fn(() => '{not-json'),
    };
    const service = createMatrixCorpusContextService({
      contextRepository: current.contextRepository,
      manifestRepository: current.manifestRepository,
      promptPreferencesRepository: current.promptPreferencesRepository,
      runtimeSettingsClient: current.runtimeSettingsClient,
      crypto,
      now: () => now,
    });

    await expect(
      service.registerScenario({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toEqual({ ok: false, code: 'CONTEXT_DECRYPTION_FAILED' });
  });

  it('returns private preference-overlay state when the catalog contains a fixed read placeholder', async () => {
    const current = await preferenceOverlayFixture();
    await expect(
      current.overlay.read({
        ingestReceiptId: 'receipt_read',
        toolName: 'get_user_preferences',
        turnIndex: 0,
        ordinal: 1,
        configuredResult: {
          toolName: 'get_user_preferences',
          status: 'completed',
          currentVersion: 99,
          items: [],
        },
      })
    ).resolves.toEqual({
      toolName: 'get_user_preferences',
      status: 'completed',
      currentVersion: 2,
      items: [{ id: syntheticPreferenceId, text: privatePreference }],
    });
  });

  it('rejects a preference-overlay read whose catalog result names another tool', async () => {
    const current = await preferenceOverlayFixture();
    await expect(
      current.overlay.read({
        ingestReceiptId: 'receipt_wrong_read_tool',
        toolName: 'get_user_preferences',
        turnIndex: 0,
        ordinal: 1,
        configuredResult: {
          toolName: 'create_note',
          status: 'completed',
          message: 'Synthetic note result',
        },
      })
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });
  });

  it('rejects a preference overlay whose persisted digest does not match its encrypted state', async () => {
    const current = await preferenceOverlayFixture();
    const stored = await current.contextRepository.getScenarioContext({
      ...current.identity,
      now,
    });
    if (!stored.ok) throw new Error('scenario context missing');
    vi.spyOn(current.contextRepository, 'getScenarioContext').mockResolvedValue({
      ok: true,
      context: { ...stored.context, overlayDigest: 'f'.repeat(64) },
    });

    await expect(
      current.overlay.read({
        ingestReceiptId: 'receipt_corrupt_digest',
        toolName: 'get_user_preferences',
        turnIndex: 0,
        ordinal: 1,
        configuredResult: {
          toolName: 'get_user_preferences',
          status: 'completed',
          currentVersion: 2,
          items: [{ id: syntheticPreferenceId, text: privatePreference }],
        },
      })
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });
  });

  it('rejects an overlay whose mutation history result names a different tool', async () => {
    const current = await preferenceOverlayFixture();
    const overlay: TestPreferenceOverlay = {
      version: 1,
      currentVersion: 3,
      items: [{ id: syntheticPreferenceId, text: privatePreference }],
      mutations: [
        {
          mutationReceipt: sha256('history-receipt'),
          argsDigest: sha256('history-args'),
          toolName: 'update_user_preference',
          turnIndex: 0,
          ordinal: 1,
          result: {
            toolName: 'delete_user_preference',
            status: 'completed',
            currentVersion: 3,
            changedItemId: syntheticPreferenceId,
          },
        },
      ],
    };
    await replaceLoadedOverlay(current, overlay);

    await expect(
      current.overlay.read({
        ingestReceiptId: 'receipt_invalid_history',
        toolName: 'get_user_preferences',
        turnIndex: 0,
        ordinal: 1,
        configuredResult: {
          toolName: 'get_user_preferences',
          status: 'completed',
          currentVersion: 3,
          items: [{ id: syntheticPreferenceId, text: privatePreference }],
        },
      })
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });
  });

  it('rejects a mutation after the bounded overlay history reaches its limit', async () => {
    const current = await preferenceOverlayFixture();
    const mutations: TestOverlayMutation[] = Array.from({ length: 200 }, (_, index) => ({
      mutationReceipt: sha256(`history-receipt-${String(index)}`),
      argsDigest: sha256(`history-args-${String(index)}`),
      toolName: 'add_user_preference',
      turnIndex: Math.floor(index / 20),
      ordinal: (index % 20) + 1,
      result: {
        toolName: 'add_user_preference',
        status: 'completed',
        currentVersion: index + 3,
        changedItemId: `mock_pref_history_${String(index)}`,
      },
    }));
    const overlay: TestPreferenceOverlay = {
      version: 1,
      currentVersion: 202,
      items: [{ id: syntheticPreferenceId, text: privatePreference }],
      mutations,
    };
    await replaceLoadedOverlay(current, overlay);
    const ingestReceiptId = 'receipt_after_history_limit';

    await expect(
      current.overlay.mutate({
        ingestReceiptId,
        mutationReceipt: matrixCorpusPreferenceMutationReceipt(
          ingestReceiptId,
          'add_user_preference',
          0,
          1
        ),
        toolName: 'add_user_preference',
        turnIndex: 0,
        ordinal: 1,
        args: { text: 'Beyond limit.', expectedVersion: 202 },
        configuredResult: {
          toolName: 'add_user_preference',
          status: 'completed',
          currentVersion: 203,
          changedItemId: 'mock_pref_beyond_limit',
        },
      })
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });
  });

  it.each([
    ['wrong configured tool', { configuredResult: { toolName: 'get_user_preferences' } }],
    ['invalid mutation receipt', { mutationReceipt: 'invalid' }],
    ['wrong expected version', { args: { text: 'Nowa.', expectedVersion: 1 } }],
    [
      'wrong result version',
      {
        configuredResult: {
          toolName: 'add_user_preference',
          status: 'completed',
          currentVersion: 9,
          changedItemId: 'mock_pref_added',
        },
      },
    ],
    ['missing add text', { args: { expectedVersion: 2 } }],
    [
      'duplicate add id',
      {
        configuredResult: {
          toolName: 'add_user_preference',
          status: 'completed',
          currentVersion: 3,
          changedItemId: syntheticPreferenceId,
        },
      },
    ],
    ['blank add text', { args: { text: '   ', expectedVersion: 2 } }],
  ] as const)('rejects invalid add overlay mutation: %s', async (_name, overrides) => {
    const current = await preferenceOverlayFixture();
    const ingestReceiptId = 'receipt_add_invalid';
    const base = {
      ingestReceiptId,
      mutationReceipt: matrixCorpusPreferenceMutationReceipt(
        ingestReceiptId,
        'add_user_preference',
        0,
        1
      ),
      toolName: 'add_user_preference' as const,
      turnIndex: 0,
      ordinal: 1,
      args: { text: 'Nowa.', expectedVersion: 2 },
      configuredResult: {
        toolName: 'add_user_preference' as const,
        status: 'completed' as const,
        currentVersion: 3,
        changedItemId: 'mock_pref_added',
      },
    };

    await expect(current.overlay.mutate({ ...base, ...overrides } as never)).rejects.toMatchObject({
      code: 'PREFERENCE_OVERLAY_REJECTED',
    });
  });

  it.each([
    ['missing item id', { args: { text: 'Nowa.', expectedVersion: 2 } }],
    [
      'non-string item id',
      { args: { itemId: 3, text: 'Nowa.', expectedVersion: 2 } },
    ],
    [
      'unknown item id',
      { args: { itemId: 'missing', text: 'Nowa.', expectedVersion: 2 } },
    ],
    [
      'changed id mismatch',
      {
        configuredResult: {
          toolName: 'update_user_preference',
          status: 'completed',
          currentVersion: 3,
          changedItemId: 'mock_pref_mismatch',
        },
      },
    ],
    [
      'unchanged text',
      { args: { itemId: syntheticPreferenceId, text: privatePreference, expectedVersion: 2 } },
    ],
  ] as const)('rejects invalid update overlay mutation: %s', async (_name, overrides) => {
    const current = await preferenceOverlayFixture();
    const ingestReceiptId = 'receipt_update_invalid';
    const base = {
      ingestReceiptId,
      mutationReceipt: matrixCorpusPreferenceMutationReceipt(
        ingestReceiptId,
        'update_user_preference',
        0,
        1
      ),
      toolName: 'update_user_preference' as const,
      turnIndex: 0,
      ordinal: 1,
      args: { itemId: syntheticPreferenceId, text: 'Nowa.', expectedVersion: 2 },
      configuredResult: {
        toolName: 'update_user_preference' as const,
        status: 'completed' as const,
        currentVersion: 3,
        changedItemId: syntheticPreferenceId,
      },
    };
    await expect(current.overlay.mutate({ ...base, ...overrides } as never)).rejects.toMatchObject({
      code: 'PREFERENCE_OVERLAY_REJECTED',
    });
  });

  it.each([
    ['missing item id', { args: { expectedVersion: 2 } }],
    ['non-string item id', { args: { itemId: 3, expectedVersion: 2 } }],
    ['unknown item id', { args: { itemId: 'missing', expectedVersion: 2 } }],
    [
      'changed id mismatch',
      {
        configuredResult: {
          toolName: 'delete_user_preference',
          status: 'completed',
          currentVersion: 3,
          changedItemId: 'mock_pref_mismatch',
        },
      },
    ],
  ] as const)('rejects invalid delete overlay mutation: %s', async (_name, overrides) => {
    const current = await preferenceOverlayFixture();
    const ingestReceiptId = 'receipt_delete_invalid';
    const base = {
      ingestReceiptId,
      mutationReceipt: matrixCorpusPreferenceMutationReceipt(
        ingestReceiptId,
        'delete_user_preference',
        0,
        1
      ),
      toolName: 'delete_user_preference' as const,
      turnIndex: 0,
      ordinal: 1,
      args: { itemId: syntheticPreferenceId, expectedVersion: 2 },
      configuredResult: {
        toolName: 'delete_user_preference' as const,
        status: 'completed' as const,
        currentVersion: 3,
        changedItemId: syntheticPreferenceId,
      },
    };
    await expect(current.overlay.mutate({ ...base, ...overrides } as never)).rejects.toMatchObject({
      code: 'PREFERENCE_OVERLAY_REJECTED',
    });
  });

  it.each(['update_user_preference', 'delete_user_preference'] as const)(
    'rejects a non-pristine %s mutation for an unknown item even when the result is self-consistent',
    async (toolName) => {
      const current = await preferenceOverlayFixture();
      const ingestReceiptId = `receipt_unknown_${toolName}`;
      const changedItemId = 'mock_pref_unknown';

      await expect(
        current.overlay.mutate({
          ingestReceiptId,
          mutationReceipt: matrixCorpusPreferenceMutationReceipt(
            ingestReceiptId,
            toolName,
            0,
            1
          ),
          toolName,
          turnIndex: 0,
          ordinal: 1,
          args:
            toolName === 'update_user_preference'
              ? { itemId: changedItemId, text: 'Unknown.', expectedVersion: 2 }
              : { itemId: changedItemId, expectedVersion: 2 },
          configuredResult: {
            toolName,
            status: 'completed',
            currentVersion: 3,
            changedItemId,
          },
        })
      ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });
    }
  );

  it('accepts an exact mutation committed by a concurrent overlay writer', async () => {
    const current = await preferenceOverlayFixture();
    const originalReplace = current.contextRepository.replaceScenarioContext.bind(
      current.contextRepository
    );
    vi.spyOn(current.contextRepository, 'replaceScenarioContext').mockImplementationOnce(
      async (input) => {
        const persisted = await originalReplace(input);
        expect(persisted).toMatchObject({ ok: true });
        return { ok: false, code: 'CORRELATED_REPLAY_CONFLICT' };
      }
    );
    const ingestReceiptId = 'receipt_raced_add';
    const result = {
      toolName: 'add_user_preference' as const,
      status: 'completed' as const,
      currentVersion: 3,
      changedItemId: 'mock_pref_raced',
    };

    await expect(
      current.overlay.mutate({
        ingestReceiptId,
        mutationReceipt: matrixCorpusPreferenceMutationReceipt(
          ingestReceiptId,
          'add_user_preference',
          0,
          1
        ),
        toolName: 'add_user_preference',
        turnIndex: 0,
        ordinal: 1,
        args: { text: 'Raced.', expectedVersion: 2 },
        configuredResult: result,
      })
    ).resolves.toEqual(result);
  });

  it('maps initial registration persistence failures and rejects a finalized write result', async () => {
    const persistence = fixture();
    vi.spyOn(persistence.contextRepository, 'registerRunContextAndManifest').mockResolvedValueOnce({
      ok: false,
      code: 'CORRUPT_CONTEXT',
    });
    await expect(persistence.service.registerRun(registration())).resolves.toEqual({
      ok: false,
      code: 'CONTEXT_PERSISTENCE_FAILED',
    });

    const seed = fixture();
    await seed.service.registerRun(registration());
    const stored = await seed.contextRepository.getRunContext({ ...registration(), now });
    if (!stored.ok) throw new Error('seed context missing');
    const finalizedWrite = fixture();
    vi.spyOn(finalizedWrite.contextRepository, 'registerRunContextAndManifest').mockResolvedValueOnce({
      ok: true,
      disposition: 'applied',
      context: {
        version: 1,
        status: 'finalized',
        runtimeAudience: 'hetzner-prod',
        runId: stored.context.runId,
        userId: stored.context.userId,
        leaseFence: stored.context.leaseFence,
        scenarioContextCount: 0,
        finalizedAt: now,
      },
    });
    await expect(finalizedWrite.service.registerRun(registration())).resolves.toEqual({
      ok: false,
      code: 'FINALIZED',
    });
  });

  it('maps invalid repository input while registering a scenario', async () => {
    const current = fixture();
    vi.spyOn(current.contextRepository, 'getRunContext').mockResolvedValueOnce({
      ok: false,
      code: 'INVALID_INPUT',
    });
    await expect(
      current.service.registerScenario({
        runId: 'run_1',
        scenarioId: 'scenario_001',
        userId: 'auth0:user_1',
        leaseFence: '7',
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('rejects overlay reads when the exact scenario context is absent', async () => {
    const current = fixture();
    const overlay = current.service.createPreferenceOverlay({
      runId: 'run_1',
      scenarioId: 'scenario_001',
      userId: 'auth0:user_1',
      leaseFence: '7',
    });
    await expect(
      overlay.read({
        ingestReceiptId: 'receipt_read',
        toolName: 'get_user_preferences',
        turnIndex: 0,
        ordinal: 1,
        configuredResult: {
          toolName: 'get_user_preferences',
          status: 'completed',
          currentVersion: 0,
          items: [],
        },
      })
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });
  });

  it('rejects a changed replay and a non-CAS overlay persistence failure', async () => {
    const replay = await preferenceOverlayFixture();
    const ingestReceiptId = 'receipt_replay';
    const request = {
      ingestReceiptId,
      mutationReceipt: matrixCorpusPreferenceMutationReceipt(
        ingestReceiptId,
        'add_user_preference',
        0,
        1
      ),
      toolName: 'add_user_preference' as const,
      turnIndex: 0,
      ordinal: 1,
      args: { text: 'Pierwsza.', expectedVersion: 2 },
      configuredResult: {
        toolName: 'add_user_preference' as const,
        status: 'completed' as const,
        currentVersion: 3,
        changedItemId: 'mock_pref_replay',
      },
    };
    await replay.overlay.mutate(request);
    await expect(
      replay.overlay.mutate({ ...request, args: { text: 'Zmieniona.', expectedVersion: 2 } })
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });

    const persistence = await preferenceOverlayFixture();
    vi.spyOn(persistence.contextRepository, 'replaceScenarioContext').mockResolvedValueOnce({
      ok: false,
      code: 'CORRUPT_CONTEXT',
    });
    await expect(persistence.overlay.mutate(request)).rejects.toMatchObject({
      code: 'PREFERENCE_OVERLAY_REJECTED',
    });
  });

  it('rejects a CAS race that did not persist the exact mutation', async () => {
    const current = await preferenceOverlayFixture();
    vi.spyOn(current.contextRepository, 'replaceScenarioContext').mockResolvedValueOnce({
      ok: false,
      code: 'CORRELATED_REPLAY_CONFLICT',
    });
    const ingestReceiptId = 'receipt_missing_race';
    await expect(
      current.overlay.mutate({
        ingestReceiptId,
        mutationReceipt: matrixCorpusPreferenceMutationReceipt(
          ingestReceiptId,
          'add_user_preference',
          0,
          1
        ),
        toolName: 'add_user_preference',
        turnIndex: 0,
        ordinal: 1,
        args: { text: 'Nieutrwalona.', expectedVersion: 2 },
        configuredResult: {
          toolName: 'add_user_preference',
          status: 'completed',
          currentVersion: 3,
          changedItemId: 'mock_pref_missing_race',
        },
      })
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });
  });

  it('rejects non-mutation configured results and unreachable mutation values', async () => {
    const current = await preferenceOverlayFixture();
    const readReceipt = 'receipt_fake_read';
    await expect(
      current.overlay.mutate({
        ingestReceiptId: readReceipt,
        mutationReceipt: matrixCorpusPreferenceMutationReceipt(
          readReceipt,
          'get_user_preferences' as never,
          0,
          1
        ),
        toolName: 'get_user_preferences',
        turnIndex: 0,
        ordinal: 1,
        args: {},
        configuredResult: {
          toolName: 'get_user_preferences',
          status: 'completed',
          currentVersion: 2,
          items: [{ id: syntheticPreferenceId, text: privatePreference }],
        },
      } as never)
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });

    const nonStringTextReceipt = 'receipt_non_string_text';
    await expect(
      current.overlay.mutate({
        ingestReceiptId: nonStringTextReceipt,
        mutationReceipt: matrixCorpusPreferenceMutationReceipt(
          nonStringTextReceipt,
          'add_user_preference',
          0,
          1
        ),
        toolName: 'add_user_preference',
        turnIndex: 0,
        ordinal: 1,
        args: { text: 3, expectedVersion: 2 },
        configuredResult: {
          toolName: 'add_user_preference',
          status: 'completed',
          currentVersion: 3,
          changedItemId: 'mock_pref_non_string',
        },
      } as never)
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });

    const missingDeleteReceipt = 'receipt_missing_delete';
    await expect(
      current.overlay.mutate({
        ingestReceiptId: missingDeleteReceipt,
        mutationReceipt: matrixCorpusPreferenceMutationReceipt(
          missingDeleteReceipt,
          'delete_user_preference',
          0,
          1
        ),
        toolName: 'delete_user_preference',
        turnIndex: 0,
        ordinal: 1,
        args: { itemId: 'missing', expectedVersion: 2 },
        configuredResult: {
          toolName: 'delete_user_preference',
          status: 'completed',
          currentVersion: 3,
          changedItemId: 'missing',
        },
      })
    ).rejects.toMatchObject({ code: 'PREFERENCE_OVERLAY_REJECTED' });
  });

});
