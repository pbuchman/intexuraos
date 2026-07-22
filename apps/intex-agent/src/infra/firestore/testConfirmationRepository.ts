import { createHash } from 'node:crypto';

import { matrixCorpusTransportMessageIdSchema } from '@intexuraos/http-contracts';
import type { Firestore } from '@intexuraos/infra-firestore';

import type {
  MatrixCorpusContextCrypto,
  MatrixCorpusContextEncryptionBindingV1,
  MatrixCorpusEncryptedValueV1,
} from '../../domain/matrixCorpus/contextCrypto.js';
import type {
  MatrixCorpusTestConfirmation,
  MatrixCorpusTestConfirmationCreateResult,
  MatrixCorpusTestConfirmationFailure,
  MatrixCorpusTestConfirmationGetResult,
  MatrixCorpusTestConfirmationIdentity,
  MatrixCorpusTestConfirmationResolveResult,
  TestConfirmationRepository,
} from '../../domain/matrixCorpus/ports/testConfirmationRepository.js';

export const INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION =
  'intex_agent_matrix_corpus_test_confirmations';

const confirmationKeys = [
  'confirmationId',
  'createdAt',
  'decision',
  'encryptedToolArgs',
  'expiresAt',
  'lane',
  'leaseFence',
  'resolutionMessageId',
  'resolvedAt',
  'runId',
  'runtimeAudience',
  'scenarioId',
  'selectionOrdinal',
  'selectionTurnIndex',
  'sessionId',
  'state',
  'toolName',
  'userBindingDigest',
  'version',
] as const;
const digestPattern = /^[a-f0-9]{64}$/u;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$/;
const fencePattern = /^[1-9][0-9]{0,19}$/;
const MAX_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const toolNames = new Set([
  'create_note',
  'create_calendar_event',
  'query_calendar_events',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'get_user_preferences',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
]);

export interface FirestoreTestConfirmationRepositoryDeps {
  firestore: Firestore;
  crypto: MatrixCorpusContextCrypto;
}

export class FirestoreTestConfirmationRepository implements TestConfirmationRepository {
  private readonly firestore: Firestore;
  private readonly crypto: MatrixCorpusContextCrypto;

  constructor(deps: FirestoreTestConfirmationRepositoryDeps) {
    this.firestore = deps.firestore;
    this.crypto = deps.crypto;
  }

  async createOrGet(
    input: Parameters<TestConfirmationRepository['createOrGet']>[0]
  ): Promise<MatrixCorpusTestConfirmationCreateResult> {
    if (!isValidCreateInput(input)) return { ok: false, code: 'CORRUPT_CONFIRMATION' };
    const ref = this.confirmationRef(input.identity.confirmationId);
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const parsed = classifyConfirmation(snapshot.data(), this.crypto, input.identity);
        if (!parsed.ok) return parsed.failure;
        if (!sameCreation(parsed.confirmation, input)) return correlatedReplayConflict();
        return {
          ok: true,
          disposition: 'already_applied',
          confirmation: cloneConfirmation(parsed.confirmation),
        };
      }

      const confirmation: MatrixCorpusTestConfirmation = {
        version: 1,
        lane: 'matrix_corpus',
        runtimeAudience: 'home-dev',
        ...input.identity,
        state: 'pending',
        toolName: input.toolName,
        toolArgs: structuredClone(input.toolArgs),
        selectionTurnIndex: input.selectionTurnIndex,
        selectionOrdinal: input.selectionOrdinal,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        decision: null,
        resolutionMessageId: null,
        resolvedAt: null,
      };
      transaction.set(ref, encryptConfirmation(confirmation, this.crypto));
      return { ok: true, disposition: 'applied', confirmation: cloneConfirmation(confirmation) };
    });
  }

  async getExact(
    input: MatrixCorpusTestConfirmationIdentity & Readonly<{ now: string }>
  ): Promise<MatrixCorpusTestConfirmationGetResult> {
    if (!isRfc3339(input.now)) return { ok: false, code: 'CORRUPT_CONFIRMATION' };
    const snapshot = await this.confirmationRef(input.confirmationId).get();
    if (!snapshot.exists) return { ok: false, code: 'NOT_FOUND' };
    const parsed = classifyConfirmation(snapshot.data(), this.crypto, input);
    if (!parsed.ok) return parsed.failure;
    if (
      parsed.confirmation.state === 'pending' &&
      Date.parse(input.now) >= Date.parse(parsed.confirmation.expiresAt)
    )
      return { ok: false, code: 'EXPIRED' };
    return { ok: true, confirmation: cloneConfirmation(parsed.confirmation) };
  }

  async resolveExact(
    input: Parameters<TestConfirmationRepository['resolveExact']>[0]
  ): Promise<MatrixCorpusTestConfirmationResolveResult> {
    if (!isRfc3339(input.now) || !isTransportMessageId(input.resolutionMessageId))
      return { ok: false, code: 'CORRUPT_CONFIRMATION' };
    const ref = this.confirmationRef(input.identity.confirmationId);
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { ok: false, code: 'NOT_FOUND' } as const;
      const parsed = classifyConfirmation(snapshot.data(), this.crypto, input.identity);
      if (!parsed.ok) return parsed.failure;
      if (parsed.confirmation.state === 'resolved') {
        if (
          parsed.confirmation.decision === input.decision &&
          parsed.confirmation.resolutionMessageId === input.resolutionMessageId &&
          parsed.confirmation.resolvedAt === input.now
        ) {
          return {
            ok: true,
            disposition: 'already_applied',
            confirmation: cloneConfirmation(parsed.confirmation),
          } as const;
        }
        return { ok: false, code: 'ALREADY_RESOLVED' } as const;
      }
      if (Date.parse(input.now) >= Date.parse(parsed.confirmation.expiresAt))
        return { ok: false, code: 'EXPIRED' } as const;
      const resolved: MatrixCorpusTestConfirmation = {
        ...parsed.confirmation,
        state: 'resolved',
        decision: input.decision,
        resolutionMessageId: input.resolutionMessageId,
        resolvedAt: input.now,
      };
      transaction.set(ref, encryptConfirmation(resolved, this.crypto));
      return { ok: true, disposition: 'applied', confirmation: cloneConfirmation(resolved) };
    });
  }

  private confirmationRef(
    confirmationId: string
  ): ReturnType<ReturnType<Firestore['collection']>['doc']> {
    return this.firestore
      .collection(INTEX_AGENT_TEST_CONFIRMATIONS_COLLECTION)
      .doc(confirmationId);
  }
}

function sameIdentity(
  confirmation: MatrixCorpusTestConfirmation,
  identity: MatrixCorpusTestConfirmationIdentity
): boolean {
  return (
    confirmation.confirmationId === identity.confirmationId &&
    confirmation.runId === identity.runId &&
    confirmation.scenarioId === identity.scenarioId &&
    confirmation.sessionId === identity.sessionId &&
    confirmation.userId === identity.userId &&
    confirmation.leaseFence === identity.leaseFence
  );
}

function sameCreation(
  confirmation: MatrixCorpusTestConfirmation,
  input: Parameters<TestConfirmationRepository['createOrGet']>[0]
): boolean {
  return (
    sameIdentity(confirmation, input.identity) &&
    confirmation.state === 'pending' &&
    confirmation.toolName === input.toolName &&
    stableJson(confirmation.toolArgs) === stableJson(input.toolArgs) &&
    confirmation.selectionTurnIndex === input.selectionTurnIndex &&
    confirmation.selectionOrdinal === input.selectionOrdinal &&
    confirmation.createdAt === input.createdAt &&
    confirmation.expiresAt === input.expiresAt
  );
}

function correlatedReplayConflict(): MatrixCorpusTestConfirmationFailure {
  return { ok: false, code: 'CORRELATED_REPLAY_CONFLICT' };
}

function cloneConfirmation(
  confirmation: MatrixCorpusTestConfirmation
): MatrixCorpusTestConfirmation {
  return { ...confirmation, toolArgs: structuredClone(confirmation.toolArgs) };
}

type StoredMatrixCorpusTestConfirmationV1 = Omit<
  MatrixCorpusTestConfirmation,
  'toolArgs' | 'userId'
> &
  Readonly<{
    encryptedToolArgs: MatrixCorpusEncryptedValueV1;
    userBindingDigest: string;
  }>;

function encryptConfirmation(
  confirmation: MatrixCorpusTestConfirmation,
  crypto: MatrixCorpusContextCrypto
): StoredMatrixCorpusTestConfirmationV1 {
  const { toolArgs, userId, ...metadata } = confirmation;
  return {
    ...metadata,
    encryptedToolArgs: crypto.encrypt(stableJson(toolArgs), confirmationBinding(confirmation)),
    userBindingDigest: sha256(userId),
  };
}

function classifyConfirmation(
  data: unknown,
  crypto: MatrixCorpusContextCrypto,
  identity: MatrixCorpusTestConfirmationIdentity
):
  | Readonly<{
      ok: true;
      confirmation: MatrixCorpusTestConfirmation;
      stored: StoredMatrixCorpusTestConfirmationV1;
    }>
  | Readonly<{ ok: false; failure: MatrixCorpusTestConfirmationFailure }> {
  /* v8 ignore start -- schema: Firestore DocumentSnapshot.data cannot return null, an array, or a primitive for an existing document @preserve */
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return { ok: false, failure: { ok: false, code: 'CORRUPT_CONFIRMATION' } };
  /* v8 ignore stop @preserve */
  if ('lane' in data && data.lane !== 'matrix_corpus')
    return { ok: false, failure: { ok: false, code: 'INVALID_LANE' } };

  const keys = Object.keys(data).sort();
  if (
    keys.length !== confirmationKeys.length ||
    confirmationKeys.some((key, index) => key !== keys[index])
  )
    return { ok: false, failure: { ok: false, code: 'CORRUPT_CONFIRMATION' } };
  const record = data as Record<string, unknown>;
  if (
    record['version'] !== 1 ||
    record['lane'] !== 'matrix_corpus' ||
    record['runtimeAudience'] !== 'home-dev' ||
    !isSafeId(record['confirmationId']) ||
    !isSafeId(record['runId']) ||
    !isSafeId(record['scenarioId']) ||
    !isSafeId(record['sessionId']) ||
    typeof record['leaseFence'] !== 'string' ||
    !fencePattern.test(record['leaseFence']) ||
    !toolNames.has(String(record['toolName'])) ||
    !isEncryptedValue(record['encryptedToolArgs']) ||
    typeof record['userBindingDigest'] !== 'string' ||
    !digestPattern.test(record['userBindingDigest']) ||
    !Number.isInteger(record['selectionTurnIndex']) ||
    Number(record['selectionTurnIndex']) < 0 ||
    Number(record['selectionTurnIndex']) > 19 ||
    !Number.isInteger(record['selectionOrdinal']) ||
    Number(record['selectionOrdinal']) < 1 ||
    Number(record['selectionOrdinal']) > 20 ||
    !isRfc3339(record['createdAt']) ||
    !isRfc3339(record['expiresAt']) ||
    Date.parse(record['expiresAt']) <= Date.parse(record['createdAt']) ||
    Date.parse(record['expiresAt']) - Date.parse(record['createdAt']) >
      MAX_CONFIRMATION_TTL_MS ||
    !hasValidResolutionState(record)
  )
    return { ok: false, failure: { ok: false, code: 'CORRUPT_CONFIRMATION' } };

  if (!storedIdentityMatches(record, identity)) return correlatedReplayConflictResult();

  const stored = record as unknown as StoredMatrixCorpusTestConfirmationV1;
  try {
    const plaintext = crypto.decrypt(
      stored.encryptedToolArgs,
      confirmationBinding({ ...stored, userId: identity.userId })
    );
    const toolArgs: unknown = JSON.parse(plaintext);
    if (
      !isRecord(toolArgs) ||
      Buffer.byteLength(plaintext, 'utf8') > 64 * 1024 ||
      stableJson(toolArgs) !== plaintext
    )
      return { ok: false, failure: { ok: false, code: 'CORRUPT_CONFIRMATION' } };
    const {
      encryptedToolArgs: _encryptedToolArgs,
      userBindingDigest: _userBindingDigest,
      ...metadata
    } = stored;
    return {
      ok: true,
      confirmation: { ...metadata, userId: identity.userId, toolArgs },
      stored: structuredClone(stored),
    };
  } catch {
    return { ok: false, failure: { ok: false, code: 'CORRUPT_CONFIRMATION' } };
  }
}

function storedIdentityMatches(
  record: Record<string, unknown>,
  identity: MatrixCorpusTestConfirmationIdentity
): boolean {
  return (
    record['confirmationId'] === identity.confirmationId &&
    record['runId'] === identity.runId &&
    record['scenarioId'] === identity.scenarioId &&
    record['sessionId'] === identity.sessionId &&
    record['leaseFence'] === identity.leaseFence &&
    record['userBindingDigest'] === sha256(identity.userId)
  );
}

function correlatedReplayConflictResult(): Readonly<{
  ok: false;
  failure: MatrixCorpusTestConfirmationFailure;
}> {
  return { ok: false, failure: correlatedReplayConflict() };
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && safeIdPattern.test(value);
}

function isTransportMessageId(value: unknown): value is string {
  return matrixCorpusTransportMessageIdSchema.safeParse(value).success;
}

function isValidCreateInput(
  input: Parameters<TestConfirmationRepository['createOrGet']>[0]
): boolean {
  return (
    isSafeId(input.identity.confirmationId) &&
    isSafeId(input.identity.runId) &&
    isSafeId(input.identity.scenarioId) &&
    isSafeId(input.identity.sessionId) &&
    isSafeId(input.identity.userId) &&
    fencePattern.test(input.identity.leaseFence) &&
    toolNames.has(input.toolName) &&
    isRecord(input.toolArgs) &&
    Buffer.byteLength(stableJson(input.toolArgs), 'utf8') <= 64 * 1024 &&
    Number.isInteger(input.selectionTurnIndex) &&
    input.selectionTurnIndex >= 0 &&
    input.selectionTurnIndex <= 19 &&
    Number.isInteger(input.selectionOrdinal) &&
    input.selectionOrdinal >= 1 &&
    input.selectionOrdinal <= 20 &&
    isRfc3339(input.createdAt) &&
    isRfc3339(input.expiresAt) &&
    Date.parse(input.expiresAt) > Date.parse(input.createdAt) &&
    Date.parse(input.expiresAt) - Date.parse(input.createdAt) <= MAX_CONFIRMATION_TTL_MS
  );
}

type ConfirmationBindingSource = MatrixCorpusTestConfirmationIdentity &
  Pick<
    MatrixCorpusTestConfirmation,
    | 'toolName'
    | 'selectionTurnIndex'
    | 'selectionOrdinal'
    | 'createdAt'
    | 'expiresAt'
    | 'state'
    | 'decision'
    | 'resolutionMessageId'
    | 'resolvedAt'
  >;

function confirmationBinding(
  confirmation: ConfirmationBindingSource
): MatrixCorpusContextEncryptionBindingV1 {
  return {
    version: 1,
    kind: 'test_confirmation_tool_args',
    runtimeAudience: 'home-dev',
    confirmationId: confirmation.confirmationId,
    runId: confirmation.runId,
    scenarioId: confirmation.scenarioId,
    sessionId: confirmation.sessionId,
    userId: confirmation.userId,
    leaseFence: confirmation.leaseFence,
    toolName: confirmation.toolName,
    selectionTurnIndex: confirmation.selectionTurnIndex,
    selectionOrdinal: confirmation.selectionOrdinal,
    createdAt: confirmation.createdAt,
    expiresAt: confirmation.expiresAt,
    state: confirmation.state,
    decision: confirmation.decision,
    resolutionMessageId: confirmation.resolutionMessageId,
    resolvedAt: confirmation.resolvedAt,
  };
}

function isEncryptedValue(value: unknown): value is MatrixCorpusEncryptedValueV1 {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 5 &&
    keys[0] === 'algorithm' &&
    keys[1] === 'authenticationTag' &&
    keys[2] === 'ciphertext' &&
    keys[3] === 'keyVersion' &&
    keys[4] === 'nonce' &&
    value['algorithm'] === 'aes-256-gcm' &&
    typeof value['authenticationTag'] === 'string' &&
    typeof value['ciphertext'] === 'string' &&
    typeof value['keyVersion'] === 'string' &&
    typeof value['nonce'] === 'string'
  );
}

function hasValidResolutionState(record: Record<string, unknown>): boolean {
  if (record['state'] === 'pending') {
    return (
      record['decision'] === null &&
      record['resolutionMessageId'] === null &&
      record['resolvedAt'] === null
    );
  }
  return (
    record['state'] === 'resolved' &&
    (record['decision'] === 'confirm' || record['decision'] === 'reject') &&
    isTransportMessageId(record['resolutionMessageId']) &&
    isRfc3339(record['createdAt']) &&
    isRfc3339(record['expiresAt']) &&
    isRfc3339(record['resolvedAt']) &&
    Date.parse(record['resolvedAt']) >= Date.parse(record['createdAt']) &&
    Date.parse(record['resolvedAt']) < Date.parse(record['expiresAt'])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
