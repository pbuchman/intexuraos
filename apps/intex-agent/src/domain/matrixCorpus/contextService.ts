import { createHash } from 'node:crypto';

import {
  strictMockResultV1Schema,
  type StrictMockResultV1,
} from '@intexuraos/http-contracts';
import type { IntexAgentRuntimeSettingsClient } from '@intexuraos/internal-clients';
import { z } from 'zod';

import type { PromptPreferencesRepository } from '../ports/promptPreferencesRepository.js';
import {
  normalizePromptPreferenceText,
  renderPromptPreferenceAgentContext,
  type IntexAgentPromptPreferences,
} from '../preferences/promptPreferences.js';
import type {
  MatrixCorpusContextCrypto,
  MatrixCorpusContextEncryptionBindingV1,
} from './contextCrypto.js';
import type {
  MatrixCorpusContextFailureCode,
  MatrixCorpusContextIdentity,
  MatrixCorpusContextRepository,
  MatrixCorpusPrivateRunContextV1,
  MatrixCorpusPrivateScenarioContextV1,
} from './ports/matrixCorpusContextRepository.js';
import type { MatrixCorpusManifestRepository } from './ports/matrixCorpusManifestRepository.js';
import {
  matrixCorpusPreferenceMutationReceipt,
  MatrixCorpusStrictToolMockError,
  type MatrixCorpusStrictPreferenceOverlay,
} from './strictToolMockExecutor.js';

const CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
const AGENT_MODEL = 'or:deepseek/deepseek-v4-flash' as const;
const EVALUATOR_MODEL = 'or:minimax/minimax-m3' as const;
const BASELINE_CATALOG_TIME_ZONE = 'Europe/Warsaw';
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const FENCE_PATTERN = /^[1-9][0-9]{0,19}$/u;
const MOCK_PREFERENCE_ID_PATTERN = /^mock_pref_[A-Za-z0-9_-]{1,112}$/u;
const MAX_OVERLAY_MUTATIONS = 200;

const overlayMutationSchema = z
  .object({
    mutationReceipt: z.string().regex(SHA_256_PATTERN),
    argsDigest: z.string().regex(SHA_256_PATTERN),
    toolName: z.enum([
      'add_user_preference',
      'update_user_preference',
      'delete_user_preference',
    ]),
    turnIndex: z.number().int().min(0).max(19),
    ordinal: z.number().int().min(1).max(20),
    result: strictMockResultV1Schema,
  })
  .strict();
const preferenceOverlayStateSchema = z
  .object({
    version: z.literal(1),
    currentVersion: z.number().int().min(0).max(1_000_000),
    items: z
      .array(
        z
          .object({
            id: z.string().regex(MOCK_PREFERENCE_ID_PATTERN),
            text: z.string().min(1).max(500),
          })
          .strict()
      )
      .max(50),
    mutations: z.array(overlayMutationSchema).max(MAX_OVERLAY_MUTATIONS),
  })
  .strict();
const encryptedPromptPayloadSchema = z
  .object({
    version: z.literal(1),
    userPreferences: z.string().max(10_000).nullable(),
    preferenceOverlay: preferenceOverlayStateSchema,
  })
  .strict();

type MatrixCorpusPreferenceOverlayStateV1 = z.infer<typeof preferenceOverlayStateSchema>;
type MatrixCorpusEncryptedPromptPayloadV1 = z.infer<typeof encryptedPromptPayloadSchema>;

export interface MatrixCorpusRunContextRegistrationInput extends MatrixCorpusContextIdentity {
  runtimeAudience: 'home-dev';
  catalogDigest: string;
  agentModel: typeof AGENT_MODEL;
  evaluatorModel: typeof EVALUATOR_MODEL;
  expectedTimeZone: string;
}

export interface MatrixCorpusScenarioContextInput extends MatrixCorpusContextIdentity {
  scenarioId: string;
}

export type MatrixCorpusContextServiceFailureCode =
  | 'INVALID_INPUT'
  | 'CORRELATED_REPLAY_CONFLICT'
  | 'RUNTIME_SETTINGS_UNAVAILABLE'
  | 'RUNTIME_SETTINGS_MISMATCH'
  | 'PROMPT_PREFERENCES_INVALID'
  | 'CONTEXT_PERSISTENCE_FAILED'
  | 'MANIFEST_PERSISTENCE_FAILED'
  | 'CONTEXT_DECRYPTION_FAILED'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'INVALIDATED'
  | 'FINALIZED';

export type MatrixCorpusRunRegistrationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      snapshot: Readonly<{
        promptPreferencesVersion: number;
        promptPreferencesDigest: string;
        agentModel: typeof AGENT_MODEL;
        userTimeZone: string;
        expiresAt: string;
      }>;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusContextServiceFailureCode }>;

export type MatrixCorpusScenarioRegistrationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      snapshot: Readonly<{
        baselinePromptPreferencesDigest: string;
        overlayVersion: number;
        overlayDigest: string;
        expiresAt: string;
      }>;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusContextServiceFailureCode }>;

export type MatrixCorpusScenarioPromptContextResult =
  | Readonly<{
      ok: true;
      promptContext: string;
      overlayVersion: number;
      overlayDigest: string;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusContextServiceFailureCode }>;

export type MatrixCorpusSessionProfileSnapshotResult =
  | Readonly<{
      ok: true;
      snapshot: Readonly<{
        promptPreferencesVersion: number;
        promptPreferencesDigest: string;
        agentModel: typeof AGENT_MODEL;
        evaluatorModel: typeof EVALUATOR_MODEL;
        userTimeZone: string;
      }>;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusContextServiceFailureCode }>;

export interface MatrixCorpusContextService {
  registerRun(
    input: MatrixCorpusRunContextRegistrationInput
  ): Promise<MatrixCorpusRunRegistrationResult>;
  registerScenario(
    input: MatrixCorpusScenarioContextInput
  ): Promise<MatrixCorpusScenarioRegistrationResult>;
  loadScenarioPromptContext(
    input: MatrixCorpusScenarioContextInput
  ): Promise<MatrixCorpusScenarioPromptContextResult>;
  loadSessionProfileSnapshot(
    input: MatrixCorpusContextIdentity
  ): Promise<MatrixCorpusSessionProfileSnapshotResult>;
  createPreferenceOverlay(
    input: MatrixCorpusScenarioContextInput
  ): MatrixCorpusStrictPreferenceOverlay;
  finalizeRun(
    input: MatrixCorpusContextIdentity
  ): ReturnType<MatrixCorpusContextRepository['finalizeRunContext']>;
}

export interface MatrixCorpusContextServiceDeps {
  contextRepository: MatrixCorpusContextRepository;
  manifestRepository: MatrixCorpusManifestRepository;
  promptPreferencesRepository: Pick<PromptPreferencesRepository, 'getCurrent'>;
  runtimeSettingsClient: Pick<
    IntexAgentRuntimeSettingsClient,
    'resolveIntexAgentRuntimeSettings'
  >;
  crypto: MatrixCorpusContextCrypto;
  now: () => string;
}

export function createMatrixCorpusContextService(
  deps: MatrixCorpusContextServiceDeps
): MatrixCorpusContextService {
  return {
    async registerRun(input): Promise<MatrixCorpusRunRegistrationResult> {
      if (!isValidRunRegistration(input)) return serviceFailure('INVALID_INPUT');
      const operationTime = deps.now();
      if (!isRfc3339(operationTime)) return serviceFailure('INVALID_INPUT');

      const existing = await deps.contextRepository.getRunContext({ ...input, now: operationTime });
      if (existing.ok) {
        if (existing.context.status === 'finalized') return serviceFailure('FINALIZED');
        if (!matchesRegistration(existing.context, input))
          return serviceFailure('CORRELATED_REPLAY_CONFLICT');
        const repaired = await deps.contextRepository.registerRunContextAndManifest({
          context: existing.context,
          manifest: manifestForContext(existing.context),
        });
        if (!repaired.ok) return mapRepositoryFailure(repaired.code);
        return runRegistrationSuccess('already_applied', existing.context);
      }
      if (existing.code !== 'NOT_FOUND') return mapRepositoryFailure(existing.code);

      const [runtimeResult, promptPreferences] = await Promise.all([
        deps.runtimeSettingsClient.resolveIntexAgentRuntimeSettings(input.userId),
        deps.promptPreferencesRepository.getCurrent(input.userId).catch(() => undefined),
      ]);
      if (!runtimeResult.ok) return serviceFailure('RUNTIME_SETTINGS_UNAVAILABLE');
      const runtime = runtimeResult.value;
      if (runtime.status !== 'available') return serviceFailure('RUNTIME_SETTINGS_UNAVAILABLE');
      if (
        runtime.effectiveModel !== AGENT_MODEL ||
        runtime.timeZone !== input.expectedTimeZone
      )
        return serviceFailure('RUNTIME_SETTINGS_MISMATCH');
      if (
        promptPreferences?.userId !== input.userId ||
        !Number.isInteger(promptPreferences.currentVersion) ||
        promptPreferences.currentVersion < 0
      )
        return serviceFailure('PROMPT_PREFERENCES_INVALID');

      let promptPayload: MatrixCorpusEncryptedPromptPayloadV1;
      try {
        renderPromptPreferenceAgentContext(promptPreferences);
        const preferenceOverlay = initialPreferenceOverlay(promptPreferences);
        promptPayload = {
          version: 1,
          userPreferences: renderOverlayPreferenceContext(preferenceOverlay),
          preferenceOverlay,
        };
      } catch {
        return serviceFailure('PROMPT_PREFERENCES_INVALID');
      }
      const promptContext = JSON.stringify(promptPayload);
      const promptPreferencesDigest = sha256(promptContext);
      const expiresAt = new Date(Date.parse(operationTime) + CONTEXT_TTL_MS).toISOString();
      const context: MatrixCorpusPrivateRunContextV1 = {
        version: 1,
        status: 'active',
        runtimeAudience: 'home-dev',
        runId: input.runId,
        userId: input.userId,
        leaseFence: input.leaseFence,
        catalogDigest: input.catalogDigest,
        agentModel: AGENT_MODEL,
        evaluatorModel: EVALUATOR_MODEL,
        promptPreferencesVersion: promptPreferences.currentVersion,
        promptPreferencesDigest,
        encryptedPromptContext: deps.crypto.encrypt(promptContext, runBinding(input)),
        userTimeZone: runtime.timeZone,
        createdAt: operationTime,
        expiresAt,
        invalidatedAt: null,
      };

      const registered = await deps.contextRepository.registerRunContextAndManifest({
        context,
        manifest: manifestForContext(context),
      });
      if (!registered.ok) {
        if (registered.code !== 'CORRELATED_REPLAY_CONFLICT')
          return mapRepositoryFailure(registered.code);
        const raced = await deps.contextRepository.getRunContext({
          ...input,
          now: operationTime,
        });
        if (!raced.ok || raced.context.status === 'finalized' || !matchesRegistration(raced.context, input))
          return serviceFailure('CORRELATED_REPLAY_CONFLICT');
        const repaired = await deps.contextRepository.registerRunContextAndManifest({
          context: raced.context,
          manifest: manifestForContext(raced.context),
        });
        if (!repaired.ok) return mapRepositoryFailure(repaired.code);
        return runRegistrationSuccess('already_applied', raced.context);
      }
      if (registered.context.status === 'finalized') return serviceFailure('FINALIZED');
      return runRegistrationSuccess(registered.disposition, registered.context);
    },

    async registerScenario(input): Promise<MatrixCorpusScenarioRegistrationResult> {
      if (!isValidScenarioInput(input)) return serviceFailure('INVALID_INPUT');
      const operationTime = deps.now();
      const runResult = await deps.contextRepository.getRunContext({
        ...input,
        now: operationTime,
      });
      if (!runResult.ok) return mapRepositoryFailure(runResult.code);
      if (runResult.context.status === 'finalized') return serviceFailure('FINALIZED');

      let promptContext: string;
      let promptPayload: MatrixCorpusEncryptedPromptPayloadV1;
      try {
        promptContext = deps.crypto.decrypt(
          runResult.context.encryptedPromptContext,
          runBinding(runResult.context)
        );
        promptPayload = encryptedPromptPayloadSchema.parse(JSON.parse(promptContext));
      } catch {
        return serviceFailure('CONTEXT_DECRYPTION_FAILED');
      }
      const overlayDigest = sha256(stableJson(promptPayload.preferenceOverlay));
      const context: MatrixCorpusPrivateScenarioContextV1 = {
        version: 1,
        runtimeAudience: 'home-dev',
        runId: input.runId,
        scenarioId: input.scenarioId,
        userId: input.userId,
        leaseFence: input.leaseFence,
        baselinePromptPreferencesDigest: runResult.context.promptPreferencesDigest,
        overlayVersion: 0,
        overlayDigest,
        encryptedEffectivePromptContext: deps.crypto.encrypt(
          promptContext,
          scenarioBinding(input)
        ),
        lastAppliedMutationReceipt: null,
        expiresAt: runResult.context.expiresAt,
        invalidatedAt: null,
      };
      const registered = await deps.contextRepository.registerScenarioContext(context);
      if (!registered.ok) return mapRepositoryFailure(registered.code);
      return scenarioRegistrationSuccess(registered.disposition, registered.context);
    },

    async loadScenarioPromptContext(input): Promise<MatrixCorpusScenarioPromptContextResult> {
      if (!isValidScenarioInput(input)) return serviceFailure('INVALID_INPUT');
      const stored = await deps.contextRepository.getScenarioContext({
        ...input,
        now: deps.now(),
      });
      if (!stored.ok) return mapRepositoryFailure(stored.code);
      try {
        const payload = encryptedPromptPayloadSchema.parse(
          JSON.parse(
            deps.crypto.decrypt(
              stored.context.encryptedEffectivePromptContext,
              scenarioBinding(stored.context)
            )
          )
        );
        return {
          ok: true,
          promptContext: JSON.stringify({
            version: 1,
            userPreferences: payload.userPreferences,
          }),
          overlayVersion: stored.context.overlayVersion,
          overlayDigest: stored.context.overlayDigest,
        };
      } catch {
        return serviceFailure('CONTEXT_DECRYPTION_FAILED');
      }
    },

    async loadSessionProfileSnapshot(input): Promise<MatrixCorpusSessionProfileSnapshotResult> {
      if (!isValidIdentity(input)) return serviceFailure('INVALID_INPUT');
      const stored = await deps.contextRepository.getRunContext({
        ...input,
        now: deps.now(),
      });
      if (!stored.ok) return mapRepositoryFailure(stored.code);
      if (stored.context.status === 'finalized') return serviceFailure('FINALIZED');
      return {
        ok: true,
        snapshot: {
          promptPreferencesVersion: stored.context.promptPreferencesVersion,
          promptPreferencesDigest: stored.context.promptPreferencesDigest,
          agentModel: stored.context.agentModel,
          evaluatorModel: stored.context.evaluatorModel,
          userTimeZone: stored.context.userTimeZone,
        },
      };
    },

    createPreferenceOverlay(input): MatrixCorpusStrictPreferenceOverlay {
      if (!isValidScenarioInput(input)) {
        throw new MatrixCorpusStrictToolMockError('safety_stop', 'PREFERENCE_OVERLAY_REJECTED');
      }
      const identity = { ...input };
      return {
        async read(request): Promise<StrictMockResultV1> {
          const loaded = await loadPreferenceOverlay(deps, identity);
          const result: StrictMockResultV1 = {
            toolName: 'get_user_preferences',
            status: 'completed',
            currentVersion: loaded.payload.preferenceOverlay.currentVersion,
            items: loaded.payload.preferenceOverlay.items.map((item) => ({ ...item })),
          };
          if (stableJson(request.configuredResult) !== stableJson(result))
            throw overlayRejected();
          return result;
        },
        async mutate(request): Promise<StrictMockResultV1> {
          return await mutatePreferenceOverlay(deps, identity, request);
        },
      };
    },

    async finalizeRun(
      input
    ): ReturnType<MatrixCorpusContextRepository['finalizeRunContext']> {
      return await deps.contextRepository.finalizeRunContext({ ...input, now: deps.now() });
    },
  };
}

function initialPreferenceOverlay(
  preferences: IntexAgentPromptPreferences
): MatrixCorpusPreferenceOverlayStateV1 {
  return {
    version: 1,
    currentVersion: preferences.currentVersion,
    items: preferences.items.map((item, index) => ({
      id: `mock_pref_${sha256(`${String(index)}:${item.id}`).slice(0, 24)}`,
      text: normalizePromptPreferenceText(item.text),
    })),
    mutations: [],
  };
}

function renderOverlayPreferenceContext(
  overlay: MatrixCorpusPreferenceOverlayStateV1
): string | null {
  if (overlay.items.length === 0) {
    if (overlay.currentVersion === 0) return null;
    return [
      `User Preferences v${String(overlay.currentVersion)}:`,
      'No active preference rows are currently defined.',
      `Use expectedVersion ${String(overlay.currentVersion)} for add_user_preference.`,
    ].join('\n');
  }
  return [
    `User Preferences v${String(overlay.currentVersion)}:`,
    ...overlay.items.map(
      (item, index) => `${String(index + 1)}. (id: ${item.id}) ${JSON.stringify(item.text)}`
    ),
    `Use expectedVersion ${String(overlay.currentVersion)} for preference mutation tools.`,
  ].join('\n');
}

type LoadedPreferenceOverlay = Readonly<{
  context: MatrixCorpusPrivateScenarioContextV1;
  payload: MatrixCorpusEncryptedPromptPayloadV1;
}>;

async function loadPreferenceOverlay(
  deps: MatrixCorpusContextServiceDeps,
  identity: MatrixCorpusScenarioContextInput
): Promise<LoadedPreferenceOverlay> {
  const stored = await deps.contextRepository.getScenarioContext({
    ...identity,
    now: deps.now(),
  });
  if (!stored.ok) throw overlayRejected();
  try {
    const payload = encryptedPromptPayloadSchema.parse(
      JSON.parse(
        deps.crypto.decrypt(
          stored.context.encryptedEffectivePromptContext,
          scenarioBinding(stored.context)
        )
      )
    );
    if (
      stored.context.overlayDigest !== sha256(stableJson(payload.preferenceOverlay)) ||
      stored.context.overlayVersion !== payload.preferenceOverlay.mutations.length ||
      payload.userPreferences !== renderOverlayPreferenceContext(payload.preferenceOverlay) ||
      !hasValidMutationHistory(payload.preferenceOverlay)
    )
      throw overlayRejected();
    return { context: stored.context, payload };
  } catch {
    throw overlayRejected();
  }
}

async function mutatePreferenceOverlay(
  deps: MatrixCorpusContextServiceDeps,
  identity: MatrixCorpusScenarioContextInput,
  request: Parameters<MatrixCorpusStrictPreferenceOverlay['mutate']>[0]
): Promise<StrictMockResultV1> {
  const parsedResult = strictMockResultV1Schema.safeParse(request.configuredResult);
  if (
    !parsedResult.success ||
    parsedResult.data.toolName !== request.toolName ||
    !SHA_256_PATTERN.test(request.mutationReceipt) ||
    request.mutationReceipt !==
      matrixCorpusPreferenceMutationReceipt(
        request.ingestReceiptId,
        request.toolName,
        request.turnIndex,
        request.ordinal
      )
  )
    throw overlayRejected();
  const configuredResult = parsedResult.data;
  if (!isPreferenceMutationResult(configuredResult)) throw overlayRejected();
  const argsDigest = sha256(stableJson(request.args));

  const loaded = await loadPreferenceOverlay(deps, identity);
  const replay = loaded.payload.preferenceOverlay.mutations.find(
    (mutation) => mutation.mutationReceipt === request.mutationReceipt
  );
  if (replay !== undefined) {
    if (
      replay.argsDigest !== argsDigest ||
      replay.toolName !== request.toolName ||
      replay.turnIndex !== request.turnIndex ||
      replay.ordinal !== request.ordinal ||
      stableJson(replay.result) !== stableJson(configuredResult)
    )
      throw overlayRejected();
    return structuredClone(replay.result);
  }

  const overlay = loaded.payload.preferenceOverlay;
  if (overlay.mutations.length >= MAX_OVERLAY_MUTATIONS) throw overlayRejected();
  const nextOverlay = applyPreferenceMutation(overlay, request, configuredResult, argsDigest);
  const nextPayload: MatrixCorpusEncryptedPromptPayloadV1 = {
    version: 1,
    userPreferences: renderOverlayPreferenceContext(nextOverlay),
    preferenceOverlay: nextOverlay,
  };
  const nextContext: MatrixCorpusPrivateScenarioContextV1 = {
    ...loaded.context,
    overlayVersion: loaded.context.overlayVersion + 1,
    overlayDigest: sha256(stableJson(nextOverlay)),
    encryptedEffectivePromptContext: deps.crypto.encrypt(
      JSON.stringify(nextPayload),
      scenarioBinding(identity)
    ),
    lastAppliedMutationReceipt: request.mutationReceipt,
  };
  const replaced = await deps.contextRepository.replaceScenarioContext({
    identity,
    expectedOverlayVersion: loaded.context.overlayVersion,
    expectedOverlayDigest: loaded.context.overlayDigest,
    context: nextContext,
    now: deps.now(),
  });
  if (replaced.ok) return structuredClone(configuredResult);
  if (replaced.code !== 'CORRELATED_REPLAY_CONFLICT') throw overlayRejected();

  const raced = await loadPreferenceOverlay(deps, identity);
  const racedReplay = raced.payload.preferenceOverlay.mutations.find(
    (mutation) => mutation.mutationReceipt === request.mutationReceipt
  );
  if (!matchesMutationReplay(racedReplay, request, argsDigest, configuredResult))
    throw overlayRejected();
  return structuredClone(racedReplay.result);
}

function applyPreferenceMutation(
  overlay: MatrixCorpusPreferenceOverlayStateV1,
  request: Parameters<MatrixCorpusStrictPreferenceOverlay['mutate']>[0],
  configuredResult: Extract<
    StrictMockResultV1,
    {
      toolName:
        | 'add_user_preference'
        | 'update_user_preference'
        | 'delete_user_preference';
    }
  >,
  argsDigest: string
): MatrixCorpusPreferenceOverlayStateV1 {
  if (
    !('expectedVersion' in request.args) ||
    request.args.expectedVersion !== overlay.currentVersion ||
    configuredResult.currentVersion !== overlay.currentVersion + 1
  )
    throw overlayRejected();
  const items = overlay.items.map((item) => ({ ...item }));
  if (request.toolName === 'add_user_preference') {
    if (!('text' in request.args) || items.some((item) => item.id === configuredResult.changedItemId))
      throw overlayRejected();
    items.push({
      id: configuredResult.changedItemId,
      text: normalizePreferenceMutationText(request.args.text),
    });
  } else if (request.toolName === 'update_user_preference') {
    if (!('itemId' in request.args) || !('text' in request.args)) throw overlayRejected();
    const itemId = request.args.itemId;
    if (typeof itemId !== 'string') throw overlayRejected();
    const index = items.findIndex((item) => item.id === itemId);
    const existing = items[index];
    if (configuredResult.changedItemId !== itemId) throw overlayRejected();
    const text = normalizePreferenceMutationText(request.args.text);
    if (existing === undefined) {
      if (!isSignedPristineOverlaySeed(overlay, configuredResult)) throw overlayRejected();
      items.push({ id: itemId, text });
    } else {
      if (text === existing.text) throw overlayRejected();
      items[index] = { ...existing, text };
    }
  } else {
    if (!('itemId' in request.args)) throw overlayRejected();
    const itemId = request.args.itemId;
    if (typeof itemId !== 'string' || configuredResult.changedItemId !== itemId)
      throw overlayRejected();
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) {
      if (!isSignedPristineOverlaySeed(overlay, configuredResult)) throw overlayRejected();
    } else {
      items.splice(index, 1);
    }
  }

  return {
    version: 1,
    currentVersion: configuredResult.currentVersion,
    items,
    mutations: [
      ...overlay.mutations.map((mutation) => structuredClone(mutation)),
      {
        mutationReceipt: request.mutationReceipt,
        argsDigest,
        toolName: request.toolName,
        turnIndex: request.turnIndex,
        ordinal: request.ordinal,
        result: structuredClone(configuredResult),
      },
    ],
  };
}

function isSignedPristineOverlaySeed(
  overlay: MatrixCorpusPreferenceOverlayStateV1,
  configuredResult: Extract<
    StrictMockResultV1,
    {
      toolName:
        | 'add_user_preference'
        | 'update_user_preference'
        | 'delete_user_preference';
    }
  >
): boolean {
  return (
    overlay.currentVersion === 0 &&
    overlay.items.length === 0 &&
    overlay.mutations.length === 0 &&
    configuredResult.currentVersion === 1
  );
}

function isPreferenceMutationResult(
  result: StrictMockResultV1
): result is Extract<
  StrictMockResultV1,
  {
    toolName:
      | 'add_user_preference'
      | 'update_user_preference'
      | 'delete_user_preference';
  }
> {
  return (
    result.toolName === 'add_user_preference' ||
    result.toolName === 'update_user_preference' ||
    result.toolName === 'delete_user_preference'
  );
}

function normalizePreferenceMutationText(value: unknown): string {
  if (typeof value !== 'string') throw overlayRejected();
  try {
    return normalizePromptPreferenceText(value);
  } catch {
    throw overlayRejected();
  }
}

function hasValidMutationHistory(overlay: MatrixCorpusPreferenceOverlayStateV1): boolean {
  const receipts = new Set<string>();
  for (const mutation of overlay.mutations) {
    if (
      receipts.has(mutation.mutationReceipt) ||
      mutation.result.toolName !== mutation.toolName
    )
      return false;
    receipts.add(mutation.mutationReceipt);
  }
  return true;
}

function matchesMutationReplay(
  mutation: MatrixCorpusPreferenceOverlayStateV1['mutations'][number] | undefined,
  request: Parameters<MatrixCorpusStrictPreferenceOverlay['mutate']>[0],
  argsDigest: string,
  configuredResult: StrictMockResultV1
): mutation is MatrixCorpusPreferenceOverlayStateV1['mutations'][number] {
  return (
    mutation?.argsDigest === argsDigest &&
    mutation.toolName === request.toolName &&
    mutation.turnIndex === request.turnIndex &&
    mutation.ordinal === request.ordinal &&
    stableJson(mutation.result) === stableJson(configuredResult)
  );
}

function overlayRejected(): MatrixCorpusStrictToolMockError {
  return new MatrixCorpusStrictToolMockError('safety_stop', 'PREFERENCE_OVERLAY_REJECTED');
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

function manifestForContext(
  context: MatrixCorpusPrivateRunContextV1
): Parameters<MatrixCorpusContextRepository['registerRunContextAndManifest']>[0]['manifest'] {
  return {
    version: 1,
    runtimeAudience: 'home-dev',
    runId: context.runId,
    userId: context.userId,
    leaseFence: context.leaseFence,
    catalogDigest: context.catalogDigest,
    scenarioBindings: [],
    artifactStage: null,
    terminalCandidate: null,
    createdAt: context.createdAt,
  };
}

function runRegistrationSuccess(
  disposition: 'applied' | 'already_applied',
  context: MatrixCorpusPrivateRunContextV1
): MatrixCorpusRunRegistrationResult {
  return {
    ok: true,
    disposition,
    snapshot: {
      promptPreferencesVersion: context.promptPreferencesVersion,
      promptPreferencesDigest: context.promptPreferencesDigest,
      agentModel: context.agentModel,
      userTimeZone: context.userTimeZone,
      expiresAt: context.expiresAt,
    },
  };
}

function scenarioRegistrationSuccess(
  disposition: 'applied' | 'already_applied',
  context: MatrixCorpusPrivateScenarioContextV1
): MatrixCorpusScenarioRegistrationResult {
  return {
    ok: true,
    disposition,
    snapshot: {
      baselinePromptPreferencesDigest: context.baselinePromptPreferencesDigest,
      overlayVersion: context.overlayVersion,
      overlayDigest: context.overlayDigest,
      expiresAt: context.expiresAt,
    },
  };
}

function matchesRegistration(
  context: MatrixCorpusPrivateRunContextV1,
  input: MatrixCorpusRunContextRegistrationInput
): boolean {
  return (
    context.runId === input.runId &&
    context.userId === input.userId &&
    context.leaseFence === input.leaseFence &&
    context.catalogDigest === input.catalogDigest &&
    context.userTimeZone === input.expectedTimeZone
  );
}

function runBinding(
  input: MatrixCorpusContextIdentity
): MatrixCorpusContextEncryptionBindingV1 {
  return {
    version: 1 as const,
    kind: 'run_prompt_context' as const,
    runtimeAudience: 'home-dev' as const,
    runId: input.runId,
    userId: input.userId,
    leaseFence: input.leaseFence,
  };
}

function scenarioBinding(
  input: MatrixCorpusScenarioContextInput
): MatrixCorpusContextEncryptionBindingV1 {
  return {
    version: 1 as const,
    kind: 'scenario_prompt_context' as const,
    runtimeAudience: 'home-dev' as const,
    runId: input.runId,
    scenarioId: input.scenarioId,
    userId: input.userId,
    leaseFence: input.leaseFence,
  };
}

function mapRepositoryFailure(
  code: MatrixCorpusContextFailureCode
): Readonly<{ ok: false; code: MatrixCorpusContextServiceFailureCode }> {
  switch (code) {
    case 'NOT_FOUND':
    case 'EXPIRED':
    case 'INVALIDATED':
    case 'FINALIZED':
    case 'CORRELATED_REPLAY_CONFLICT':
      return serviceFailure(code);
    case 'INVALID_INPUT':
      return serviceFailure('INVALID_INPUT');
    case 'CORRUPT_CONTEXT':
    case 'MANIFEST_MISMATCH':
      return serviceFailure('CONTEXT_PERSISTENCE_FAILED');
  }
}

function serviceFailure(
  code: MatrixCorpusContextServiceFailureCode
): Readonly<{ ok: false; code: MatrixCorpusContextServiceFailureCode }> {
  return { ok: false, code } as const;
}

function isValidRunRegistration(input: MatrixCorpusRunContextRegistrationInput): boolean {
  const raw = input as unknown as Record<string, unknown>;
  return (
    raw['runtimeAudience'] === 'home-dev' &&
    isValidIdentity(input) &&
    SHA_256_PATTERN.test(input.catalogDigest) &&
    raw['agentModel'] === AGENT_MODEL &&
    raw['evaluatorModel'] === EVALUATOR_MODEL &&
    input.expectedTimeZone === BASELINE_CATALOG_TIME_ZONE
  );
}

function isValidScenarioInput(input: MatrixCorpusScenarioContextInput): boolean {
  return isValidIdentity(input) && SAFE_ID_PATTERN.test(input.scenarioId);
}

function isValidIdentity(input: MatrixCorpusContextIdentity): boolean {
  return (
    SAFE_ID_PATTERN.test(input.runId) &&
    SAFE_ID_PATTERN.test(input.userId) &&
    FENCE_PATTERN.test(input.leaseFence)
  );
}

function isRfc3339(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && /(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
