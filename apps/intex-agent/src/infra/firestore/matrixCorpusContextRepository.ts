import { createHash } from 'node:crypto';

import type { Firestore } from '@intexuraos/infra-firestore';

import type { MatrixCorpusEncryptedValueV1 } from '../../domain/matrixCorpus/contextCrypto.js';
import type {
  MatrixCorpusContextFailureCode,
  MatrixCorpusContextFinalizationV1,
  MatrixCorpusContextIdentity,
  MatrixCorpusContextRepository,
  MatrixCorpusPrivateRunContextV1,
  MatrixCorpusPrivateScenarioContextV1,
  MatrixCorpusRunContextGetResult,
  MatrixCorpusRunContextMutationResult,
  MatrixCorpusRunContextRecordV1,
  MatrixCorpusScenarioContextGetResult,
  MatrixCorpusScenarioContextMutationResult,
} from '../../domain/matrixCorpus/ports/matrixCorpusContextRepository.js';
import {
  INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION,
  parseMatrixCorpusRunManifestDocument,
} from './matrixCorpusManifestRepository.js';

type FirestoreDocumentReference = ReturnType<ReturnType<Firestore['collection']>['doc']>;

export const INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION =
  'intex_agent_matrix_corpus_run_contexts';
export const INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION =
  'intex_agent_matrix_corpus_scenario_contexts';
export const INTEX_AGENT_MATRIX_CORPUS_RECOVERY_RECEIPTS_COLLECTION =
  'intex_agent_matrix_corpus_recovery_receipts';

const MAX_SCENARIO_CONTEXTS = 20;
const CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const FENCE_PATTERN = /^[1-9][0-9]{0,19}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const activeRunKeys = [
  'agentModel',
  'catalogDigest',
  'createdAt',
  'encryptedPromptContext',
  'evaluatorModel',
  'expiresAt',
  'invalidatedAt',
  'leaseFence',
  'promptPreferencesDigest',
  'promptPreferencesVersion',
  'runId',
  'runtimeAudience',
  'status',
  'userId',
  'userTimeZone',
  'version',
] as const;
const finalizedRunKeys = [
  'finalizedAt',
  'leaseFence',
  'runId',
  'runtimeAudience',
  'scenarioContextCount',
  'status',
  'userId',
  'version',
] as const;
const scenarioKeys = [
  'baselinePromptPreferencesDigest',
  'encryptedEffectivePromptContext',
  'expiresAt',
  'invalidatedAt',
  'lastAppliedMutationReceipt',
  'leaseFence',
  'overlayDigest',
  'overlayVersion',
  'runId',
  'runtimeAudience',
  'scenarioId',
  'userId',
  'version',
] as const;
const encryptedValueKeys = [
  'algorithm',
  'authenticationTag',
  'ciphertext',
  'keyVersion',
  'nonce',
] as const;

export interface FirestoreMatrixCorpusContextRepositoryDeps {
  firestore: Firestore;
}

export class FirestoreMatrixCorpusContextRepository implements MatrixCorpusContextRepository {
  private readonly firestore: Firestore;

  constructor(deps: FirestoreMatrixCorpusContextRepositoryDeps) {
    this.firestore = deps.firestore;
  }

  async registerRunContextAndManifest(
    input: Parameters<MatrixCorpusContextRepository['registerRunContextAndManifest']>[0]
  ): Promise<MatrixCorpusRunContextMutationResult> {
    const proposedManifest = parseMatrixCorpusRunManifestDocument(input.manifest);
    if (
      !isValidActiveRunContext(input.context) ||
      proposedManifest?.scenarioBindings.length !== 0 ||
      proposedManifest.terminalCandidate !== null ||
      !sameIdentity(input.context, proposedManifest) ||
      input.context.catalogDigest !== proposedManifest.catalogDigest ||
      input.context.createdAt !== proposedManifest.createdAt
    )
      return failure('INVALID_INPUT');

    const runRef = this.runRef(input.context.runId);
    const manifestRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(input.context.runId);
    const recoveryRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RECOVERY_RECEIPTS_COLLECTION)
      .doc(input.context.runId);
    return await this.firestore.runTransaction(async (transaction) => {
      const [runSnapshot, manifestSnapshot, recoverySnapshot] = await Promise.all([
        transaction.get(runRef),
        transaction.get(manifestRef),
        transaction.get(recoveryRef),
      ]);
      if (recoverySnapshot.exists) return failure('FINALIZED');
      const existingContext = runSnapshot.exists
        ? parseRunContext(runSnapshot.data())
        : undefined;
      const existingManifest = manifestSnapshot.exists
        ? parseMatrixCorpusRunManifestDocument(manifestSnapshot.data())
        : undefined;
      if (runSnapshot.exists && existingContext === undefined)
        return failure('CORRUPT_CONTEXT');
      if (manifestSnapshot.exists && existingManifest === undefined)
        return failure('MANIFEST_MISMATCH');
      if (existingContext?.status === 'finalized') return failure('FINALIZED');
      if (
        (existingContext !== undefined &&
          stableJson(existingContext) !== stableJson(input.context)) ||
        (existingManifest !== undefined &&
          stableJson(existingManifest) !== stableJson(proposedManifest))
      )
        return failure('CORRELATED_REPLAY_CONFLICT');

      if (!runSnapshot.exists) transaction.set(runRef, cloneRunContext(input.context));
      if (!manifestSnapshot.exists) transaction.set(manifestRef, structuredClone(proposedManifest));
      return runSuccess(
        runSnapshot.exists && manifestSnapshot.exists ? 'already_applied' : 'applied',
        existingContext ?? input.context
      );
    });
  }

  async registerRunContext(
    context: MatrixCorpusPrivateRunContextV1
  ): Promise<MatrixCorpusRunContextMutationResult> {
    if (!isValidIdentity(context)) return failure('INVALID_INPUT');
    const ref = this.runRef(context.runId);
    const recoveryRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RECOVERY_RECEIPTS_COLLECTION)
      .doc(context.runId);
    return await this.firestore.runTransaction(async (transaction) => {
      const [snapshot, recoverySnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(recoveryRef),
      ]);
      if (recoverySnapshot.exists) return failure('FINALIZED');
      if (snapshot.exists) {
        const existing = parseRunContext(snapshot.data());
        if (existing === undefined) return failure('CORRUPT_CONTEXT');
        if (existing.status === 'finalized') return failure('FINALIZED');
        return stableJson(existing) === stableJson(context)
          ? runSuccess('already_applied', existing)
          : failure('CORRELATED_REPLAY_CONFLICT');
      }
      if (!isValidActiveRunContext(context)) return failure('INVALID_INPUT');
      transaction.set(ref, cloneRunContext(context));
      return runSuccess('applied', context);
    });
  }

  async registerScenarioContext(
    context: MatrixCorpusPrivateScenarioContextV1
  ): Promise<MatrixCorpusScenarioContextMutationResult> {
    if (!isValidIdentity(context) || !SAFE_ID_PATTERN.test(context.scenarioId))
      return failure('INVALID_INPUT');
    const runRef = this.runRef(context.runId);
    const scenarioRef = this.scenarioRef(context.runId, context.scenarioId);
    const recoveryRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RECOVERY_RECEIPTS_COLLECTION)
      .doc(context.runId);
    return await this.firestore.runTransaction(async (transaction) => {
      const [runSnapshot, scenarioSnapshot, recoverySnapshot] = await Promise.all([
        transaction.get(runRef),
        transaction.get(scenarioRef),
        transaction.get(recoveryRef),
      ]);
      if (recoverySnapshot.exists) return failure('FINALIZED');
      if (!runSnapshot.exists) return failure('NOT_FOUND');
      const run = parseRunContext(runSnapshot.data());
      if (run === undefined) return failure('CORRUPT_CONTEXT');
      if (run.status === 'finalized') return failure('FINALIZED');
      if (!sameIdentity(run, context)) return failure('CORRELATED_REPLAY_CONFLICT');
      if (scenarioSnapshot.exists) {
        const existing = parseScenarioContext(scenarioSnapshot.data());
        if (existing === undefined) return failure('CORRUPT_CONTEXT');
        return stableJson(existing) === stableJson(context)
          ? scenarioSuccess('already_applied', existing)
          : failure('CORRELATED_REPLAY_CONFLICT');
      }
      if (
        !isValidScenarioContext(context) ||
        context.baselinePromptPreferencesDigest !== run.promptPreferencesDigest ||
        context.expiresAt !== run.expiresAt
      )
        return failure('INVALID_INPUT');
      transaction.set(scenarioRef, cloneScenarioContext(context));
      return scenarioSuccess('applied', context);
    });
  }

  async replaceScenarioContext(
    input: Parameters<MatrixCorpusContextRepository['replaceScenarioContext']>[0]
  ): Promise<MatrixCorpusScenarioContextMutationResult> {
    if (
      !isValidIdentity(input.identity) ||
      !SAFE_ID_PATTERN.test(input.identity.scenarioId) ||
      !isRfc3339(input.now) ||
      !Number.isInteger(input.expectedOverlayVersion) ||
      input.expectedOverlayVersion < 0 ||
      !SHA_256_PATTERN.test(input.expectedOverlayDigest) ||
      !isValidScenarioContext(input.context) ||
      !sameIdentity(input.context, input.identity) ||
      input.context.scenarioId !== input.identity.scenarioId
    )
      return failure('INVALID_INPUT');

    const runRef = this.runRef(input.identity.runId);
    const scenarioRef = this.scenarioRef(input.identity.runId, input.identity.scenarioId);
    const recoveryRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RECOVERY_RECEIPTS_COLLECTION)
      .doc(input.identity.runId);
    return await this.firestore.runTransaction(async (transaction) => {
      const [runSnapshot, scenarioSnapshot, recoverySnapshot] = await Promise.all([
        transaction.get(runRef),
        transaction.get(scenarioRef),
        transaction.get(recoveryRef),
      ]);
      if (recoverySnapshot.exists) return failure('FINALIZED');
      if (!runSnapshot.exists || !scenarioSnapshot.exists) return failure('NOT_FOUND');
      const run = parseRunContext(runSnapshot.data());
      const current = parseScenarioContext(scenarioSnapshot.data());
      if (run === undefined || current === undefined) return failure('CORRUPT_CONTEXT');
      if (run.status === 'finalized') return failure('FINALIZED');
      if (
        !sameIdentity(run, input.identity) ||
        !sameIdentity(current, input.identity) ||
        current.scenarioId !== input.identity.scenarioId
      )
        return failure('CORRELATED_REPLAY_CONFLICT');
      if (current.invalidatedAt !== null) return failure('INVALIDATED');
      if (Date.parse(input.now) >= Date.parse(current.expiresAt)) return failure('EXPIRED');
      if (
        current.overlayVersion !== input.expectedOverlayVersion ||
        current.overlayDigest !== input.expectedOverlayDigest
      )
        return failure('CORRELATED_REPLAY_CONFLICT');
      if (!isValidScenarioReplacement(current, input.context))
        return failure('CORRELATED_REPLAY_CONFLICT');

      transaction.set(scenarioRef, cloneScenarioContext(input.context));
      return scenarioSuccess('applied', input.context);
    });
  }

  async getRunContext(
    input: Parameters<MatrixCorpusContextRepository['getRunContext']>[0]
  ): Promise<MatrixCorpusRunContextGetResult> {
    if (!isValidIdentity(input) || !isRfc3339(input.now)) return failure('INVALID_INPUT');
    const snapshot = await this.runRef(input.runId).get();
    if (!snapshot.exists) return failure('NOT_FOUND');
    const context = parseRunContext(snapshot.data());
    if (context === undefined) return failure('CORRUPT_CONTEXT');
    if (!sameIdentity(context, input)) return failure('CORRELATED_REPLAY_CONFLICT');
    if (context.status === 'active') {
      if (context.invalidatedAt !== null) return failure('INVALIDATED');
      if (Date.parse(input.now) >= Date.parse(context.expiresAt)) return failure('EXPIRED');
    }
    return { ok: true, context: cloneRunContext(context) };
  }

  async getScenarioContext(
    input: Parameters<MatrixCorpusContextRepository['getScenarioContext']>[0]
  ): Promise<MatrixCorpusScenarioContextGetResult> {
    if (
      !isValidIdentity(input) ||
      !SAFE_ID_PATTERN.test(input.scenarioId) ||
      !isRfc3339(input.now)
    )
      return failure('INVALID_INPUT');
    const snapshot = await this.scenarioRef(input.runId, input.scenarioId).get();
    if (!snapshot.exists) return failure('NOT_FOUND');
    const context = parseScenarioContext(snapshot.data());
    if (context === undefined) return failure('CORRUPT_CONTEXT');
    if (!sameIdentity(context, input) || context.scenarioId !== input.scenarioId)
      return failure('CORRELATED_REPLAY_CONFLICT');
    if (context.invalidatedAt !== null) return failure('INVALIDATED');
    if (Date.parse(input.now) >= Date.parse(context.expiresAt)) return failure('EXPIRED');
    return { ok: true, context: cloneScenarioContext(context) };
  }

  async finalizeRunContext(
    input: Parameters<MatrixCorpusContextRepository['finalizeRunContext']>[0]
  ): Promise<MatrixCorpusRunContextMutationResult> {
    if (!isValidIdentity(input) || !isRfc3339(input.now)) return failure('INVALID_INPUT');
    const runRef = this.runRef(input.runId);
    const manifestRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(input.runId);
    const scenarioQuery = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
      .where('runId', '==', input.runId);

    return await this.firestore.runTransaction(async (transaction) => {
      const [runSnapshot, manifestSnapshot, scenarioSnapshot] = await Promise.all([
        transaction.get(runRef),
        transaction.get(manifestRef),
        transaction.get(scenarioQuery),
      ]);
      if (!runSnapshot.exists) return failure('NOT_FOUND');
      const run = parseRunContext(runSnapshot.data());
      if (run === undefined) return failure('CORRUPT_CONTEXT');
      if (!sameIdentity(run, input)) return failure('CORRELATED_REPLAY_CONFLICT');
      if (run.status === 'finalized') return runSuccess('already_applied', run);
      if (run.invalidatedAt !== null) return failure('INVALIDATED');
      if (Date.parse(input.now) >= Date.parse(run.expiresAt)) return failure('EXPIRED');
      if (!manifestSnapshot.exists) return failure('MANIFEST_MISMATCH');
      const manifest = parseMatrixCorpusRunManifestDocument(manifestSnapshot.data());
      if (manifest === undefined || !sameIdentity(manifest, input))
        return failure('MANIFEST_MISMATCH');
      /* v8 ignore start -- schema: a parsed manifest cannot exceed the same MAX_SCENARIO_CONTEXTS bound enforced here @preserve */
      if (manifest.scenarioBindings.length > MAX_SCENARIO_CONTEXTS)
        return failure('MANIFEST_MISMATCH');
      /* v8 ignore stop @preserve */

      const parsedScenarios = scenarioSnapshot.docs.map((document) => ({
        ref: document.ref,
        context: parseScenarioContext(document.data()),
      }));
      if (
        parsedScenarios.length !== manifest.scenarioBindings.length ||
        parsedScenarios.some(({ context }) => context === undefined)
      )
        return failure('MANIFEST_MISMATCH');
      const scenarioById = new Map(
        parsedScenarios.map(({ context, ref }) => [context?.scenarioId, { context, ref }])
      );
      for (const binding of manifest.scenarioBindings) {
        const entry = scenarioById.get(binding.scenarioId);
        if (
          entry?.context === undefined ||
          !sameIdentity(entry.context, input) ||
          entry.context.baselinePromptPreferencesDigest !== run.promptPreferencesDigest ||
          entry.context.expiresAt !== run.expiresAt
        )
          return failure('MANIFEST_MISMATCH');
      }

      const finalized: MatrixCorpusContextFinalizationV1 = {
        version: 1,
        status: 'finalized',
        runtimeAudience: 'home-dev',
        runId: input.runId,
        userId: input.userId,
        leaseFence: input.leaseFence,
        scenarioContextCount: parsedScenarios.length,
        finalizedAt: input.now,
      };
      for (const { ref } of parsedScenarios) transaction.delete(ref);
      transaction.set(runRef, finalized);
      return runSuccess('applied', finalized);
    });
  }

  private runRef(runId: string): FirestoreDocumentReference {
    return this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc(runId);
  }

  private scenarioRef(runId: string, scenarioId: string): FirestoreDocumentReference {
    const id = createHash('sha256')
      .update(`${runId}\u0000${scenarioId}`, 'utf8')
      .digest('hex')
      .slice(0, 32);
    return this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_SCENARIO_CONTEXTS_COLLECTION)
      .doc(id);
  }
}

function isValidScenarioReplacement(
  current: MatrixCorpusPrivateScenarioContextV1,
  proposed: MatrixCorpusPrivateScenarioContextV1
): boolean {
  return (
    proposed.runId === current.runId &&
    proposed.scenarioId === current.scenarioId &&
    proposed.userId === current.userId &&
    proposed.leaseFence === current.leaseFence &&
    proposed.baselinePromptPreferencesDigest === current.baselinePromptPreferencesDigest &&
    proposed.expiresAt === current.expiresAt &&
    proposed.invalidatedAt === null &&
    proposed.overlayVersion === current.overlayVersion + 1 &&
    proposed.overlayDigest !== current.overlayDigest &&
    proposed.lastAppliedMutationReceipt !== null &&
    stableJson(proposed.encryptedEffectivePromptContext) !==
      stableJson(current.encryptedEffectivePromptContext)
  );
}

function failure(
  code: MatrixCorpusContextFailureCode
): Readonly<{ ok: false; code: MatrixCorpusContextFailureCode }> {
  return { ok: false, code } as const;
}

function runSuccess(
  disposition: 'applied' | 'already_applied',
  context: MatrixCorpusRunContextRecordV1
): MatrixCorpusRunContextMutationResult {
  return { ok: true, disposition, context: cloneRunContext(context) };
}

function scenarioSuccess(
  disposition: 'applied' | 'already_applied',
  context: MatrixCorpusPrivateScenarioContextV1
): MatrixCorpusScenarioContextMutationResult {
  return { ok: true, disposition, context: cloneScenarioContext(context) };
}

function parseRunContext(value: unknown): MatrixCorpusRunContextRecordV1 | undefined {
  if (hasExactKeys(value, activeRunKeys)) {
    const context = value as unknown as MatrixCorpusPrivateRunContextV1;
    return isValidActiveRunContext(context) ? context : undefined;
  }
  if (hasExactKeys(value, finalizedRunKeys)) {
    const context = value as unknown as MatrixCorpusContextFinalizationV1;
    return isValidFinalization(context) ? context : undefined;
  }
  return undefined;
}

export function parseMatrixCorpusRunContextDocument(
  value: unknown
): MatrixCorpusRunContextRecordV1 | undefined {
  return parseRunContext(value);
}

export function parseMatrixCorpusScenarioContextDocument(
  value: unknown
): MatrixCorpusPrivateScenarioContextV1 | undefined {
  if (!hasExactKeys(value, scenarioKeys)) return undefined;
  const context = value as unknown as MatrixCorpusPrivateScenarioContextV1;
  return isValidScenarioContext(context) ? context : undefined;
}

const parseScenarioContext = parseMatrixCorpusScenarioContextDocument;

function isValidActiveRunContext(context: MatrixCorpusPrivateRunContextV1): boolean {
  const runtime = context as unknown as Readonly<Record<string, unknown>>;
  const created = Date.parse(context.createdAt);
  const expires = Date.parse(context.expiresAt);
  return (
    runtime['version'] === 1 &&
    runtime['status'] === 'active' &&
    runtime['runtimeAudience'] === 'home-dev' &&
    isValidIdentity(context) &&
    SHA_256_PATTERN.test(context.catalogDigest) &&
    runtime['agentModel'] === 'or:deepseek/deepseek-v4-flash' &&
    runtime['evaluatorModel'] === 'or:minimax/minimax-m3' &&
    Number.isInteger(context.promptPreferencesVersion) &&
    context.promptPreferencesVersion >= 0 &&
    SHA_256_PATTERN.test(context.promptPreferencesDigest) &&
    isValidEncryptedValue(context.encryptedPromptContext) &&
    isIanaTimeZone(context.userTimeZone) &&
    isRfc3339(context.createdAt) &&
    isRfc3339(context.expiresAt) &&
    expires - created === CONTEXT_TTL_MS &&
    (context.invalidatedAt === null || isRfc3339(context.invalidatedAt))
  );
}

function isValidScenarioContext(context: MatrixCorpusPrivateScenarioContextV1): boolean {
  const runtime = context as unknown as Readonly<Record<string, unknown>>;
  return (
    runtime['version'] === 1 &&
    runtime['runtimeAudience'] === 'home-dev' &&
    isValidIdentity(context) &&
    SAFE_ID_PATTERN.test(context.scenarioId) &&
    SHA_256_PATTERN.test(context.baselinePromptPreferencesDigest) &&
    Number.isInteger(context.overlayVersion) &&
    context.overlayVersion >= 0 &&
    SHA_256_PATTERN.test(context.overlayDigest) &&
    isValidEncryptedValue(context.encryptedEffectivePromptContext) &&
    (context.lastAppliedMutationReceipt === null ||
      SAFE_ID_PATTERN.test(context.lastAppliedMutationReceipt)) &&
    isRfc3339(context.expiresAt) &&
    (context.invalidatedAt === null || isRfc3339(context.invalidatedAt))
  );
}

function isValidFinalization(context: MatrixCorpusContextFinalizationV1): boolean {
  const runtime = context as unknown as Readonly<Record<string, unknown>>;
  return (
    runtime['version'] === 1 &&
    runtime['status'] === 'finalized' &&
    runtime['runtimeAudience'] === 'home-dev' &&
    isValidIdentity(context) &&
    Number.isInteger(context.scenarioContextCount) &&
    context.scenarioContextCount >= 0 &&
    context.scenarioContextCount <= MAX_SCENARIO_CONTEXTS &&
    isRfc3339(context.finalizedAt)
  );
}

function isValidEncryptedValue(value: MatrixCorpusEncryptedValueV1): boolean {
  if (!hasExactKeys(value, encryptedValueKeys)) return false;
  const runtime = value as unknown as Readonly<Record<string, unknown>>;
  return (
    runtime['algorithm'] === 'aes-256-gcm' &&
    SAFE_ID_PATTERN.test(value.keyVersion) &&
    isCanonicalBase64url(value.nonce) &&
    isCanonicalBase64url(value.ciphertext, true) &&
    isCanonicalBase64url(value.authenticationTag) &&
    Buffer.from(value.nonce, 'base64url').byteLength === 12 &&
    Buffer.from(value.authenticationTag, 'base64url').byteLength === 16 &&
    Buffer.from(value.ciphertext, 'base64url').byteLength <= 20_000
  );
}

function isCanonicalBase64url(value: string, allowEmpty = false): boolean {
  if (value === '') return allowEmpty;
  return (
    value.length % 4 !== 1 &&
    BASE64URL_PATTERN.test(value) &&
    Buffer.from(value, 'base64url').toString('base64url') === value
  );
}

function isValidIdentity(value: MatrixCorpusContextIdentity): boolean {
  return (
    SAFE_ID_PATTERN.test(value.runId) &&
    SAFE_ID_PATTERN.test(value.userId) &&
    FENCE_PATTERN.test(value.leaseFence)
  );
}

function sameIdentity(
  context: MatrixCorpusContextIdentity,
  identity: MatrixCorpusContextIdentity
): boolean {
  return (
    context.runId === identity.runId &&
    context.userId === identity.userId &&
    context.leaseFence === identity.leaseFence
  );
}

function isRfc3339(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && /(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value);
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[]
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length && expectedKeys.every((key, index) => key === keys[index]);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function cloneRunContext(context: MatrixCorpusRunContextRecordV1): MatrixCorpusRunContextRecordV1 {
  return context.status === 'active'
    ? { ...context, encryptedPromptContext: { ...context.encryptedPromptContext } }
    : { ...context };
}

function cloneScenarioContext(
  context: MatrixCorpusPrivateScenarioContextV1
): MatrixCorpusPrivateScenarioContextV1 {
  return {
    ...context,
    encryptedEffectivePromptContext: { ...context.encryptedEffectivePromptContext },
  };
}
