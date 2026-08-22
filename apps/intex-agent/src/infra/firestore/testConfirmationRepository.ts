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
  MatrixCorpusTestConfirmationOperation,
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
const MAX_CONFIRMATION_OPERATIONS = 20;
const MAX_CONFIRMATION_PAYLOAD_BYTES = 64 * 1024;
const toolNames = new Set([
  'create_note',
  'create_calendar_event',
  'update_calendar_event',
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
        runtimeAudience: 'hetzner-prod',
        ...input.identity,
        state: 'pending',
        toolName: input.toolName,
        toolArgs: structuredClone(input.toolArgs),
        selectionTurnIndex: input.selectionTurnIndex,
        selectionOrdinal: input.selectionOrdinal,
        ...(input.operations === undefined
          ? {}
          : { operations: structuredClone(input.operations) }),
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
    stableJson(confirmation.operations ?? null) === stableJson(input.operations ?? null) &&
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
  return {
    ...confirmation,
    toolArgs: structuredClone(confirmation.toolArgs),
    ...(confirmation.operations === undefined
      ? {}
      : { operations: structuredClone(confirmation.operations) }),
  };
}

type StoredMatrixCorpusTestConfirmationV1 = Omit<
  MatrixCorpusTestConfirmation,
  'operations' | 'toolArgs' | 'userId'
> &
  Readonly<{
    encryptedToolArgs: MatrixCorpusEncryptedValueV1;
    userBindingDigest: string;
  }>;

export interface MatrixCorpusTestConfirmationEvidenceIdentity {
  confirmationId: string;
  runId: string;
  scenarioId: string;
  sessionId: string;
  leaseFence: string;
}

export function parseMatrixCorpusTestConfirmationEvidenceDocument(
  documentId: string,
  data: unknown,
  crypto: MatrixCorpusContextCrypto,
  expected: Pick<MatrixCorpusTestConfirmationIdentity, 'runId' | 'userId' | 'leaseFence'>
): MatrixCorpusTestConfirmationEvidenceIdentity | undefined {
  if (!isRecord(data)) return undefined;
  const scenarioId = data['scenarioId'];
  const sessionId = data['sessionId'];
  if (typeof scenarioId !== 'string' || typeof sessionId !== 'string') return undefined;
  const parsed = classifyConfirmation(data, crypto, {
    confirmationId: documentId,
    runId: expected.runId,
    scenarioId,
    sessionId,
    userId: expected.userId,
    leaseFence: expected.leaseFence,
  });
  if (!parsed.ok) return undefined;
  return {
    confirmationId: parsed.confirmation.confirmationId,
    runId: parsed.confirmation.runId,
    scenarioId: parsed.confirmation.scenarioId,
    sessionId: parsed.confirmation.sessionId,
    leaseFence: parsed.confirmation.leaseFence,
  };
}

function encryptConfirmation(
  confirmation: MatrixCorpusTestConfirmation,
  crypto: MatrixCorpusContextCrypto
): StoredMatrixCorpusTestConfirmationV1 {
  const { operations, toolArgs, userId, ...metadata } = confirmation;
  return {
    ...metadata,
    encryptedToolArgs: crypto.encrypt(
      stableJson(confirmationPayload(toolArgs, operations)),
      confirmationBinding(confirmation)
    ),
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
    record['runtimeAudience'] !== 'hetzner-prod' ||
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
    const decrypted: unknown = JSON.parse(plaintext);
    if (
      !isRecord(decrypted) ||
      Buffer.byteLength(plaintext, 'utf8') > MAX_CONFIRMATION_PAYLOAD_BYTES ||
      stableJson(decrypted) !== plaintext
    )
      return { ok: false, failure: { ok: false, code: 'CORRUPT_CONFIRMATION' } };
    const {
      encryptedToolArgs: _encryptedToolArgs,
      userBindingDigest: _userBindingDigest,
      ...metadata
    } = stored;
    const payload = parseConfirmationPayload(decrypted, {
      toolName: metadata.toolName,
      selectionTurnIndex: metadata.selectionTurnIndex,
      selectionOrdinal: metadata.selectionOrdinal,
    });
    if (payload === undefined)
      return { ok: false, failure: { ok: false, code: 'CORRUPT_CONFIRMATION' } };
    return {
      ok: true,
      confirmation: {
        ...metadata,
        userId: identity.userId,
        toolArgs: payload.toolArgs,
        ...(payload.operations === undefined ? {} : { operations: payload.operations }),
      },
      stored: structuredClone(stored),
    };
  } catch {
    return { ok: false, failure: { ok: false, code: 'CORRUPT_CONFIRMATION' } };
  }
}

type ConfirmationSelectionBinding = Pick<
  MatrixCorpusTestConfirmationOperation,
  'selectionOrdinal' | 'selectionTurnIndex' | 'toolName'
>;

type ConfirmationPayload = Readonly<{
  toolArgs: Record<string, unknown>;
  operations?: readonly MatrixCorpusTestConfirmationOperation[];
}>;

function confirmationPayload(
  toolArgs: Record<string, unknown>,
  operations: readonly MatrixCorpusTestConfirmationOperation[] | undefined
): Record<string, unknown> {
  return operations === undefined ? toolArgs : { toolArgs, operations };
}

function parseConfirmationPayload(
  decrypted: Record<string, unknown>,
  singular: ConfirmationSelectionBinding
): ConfirmationPayload | undefined {
  if (!Object.hasOwn(decrypted, 'operations')) {
    return { toolArgs: structuredClone(decrypted) };
  }
  const keys = Object.keys(decrypted).sort();
  if (keys.length !== 2 || keys[0] !== 'operations' || keys[1] !== 'toolArgs') {
    return undefined;
  }
  const toolArgs = decrypted['toolArgs'];
  if (!isRecord(toolArgs)) return undefined;
  const operations = parseConfirmationOperations(decrypted['operations'], {
    ...singular,
    toolArgs,
  });
  if (operations === undefined) return undefined;
  return { toolArgs: structuredClone(toolArgs), operations };
}

function parseConfirmationOperations(
  value: unknown,
  singular: MatrixCorpusTestConfirmationOperation
): readonly MatrixCorpusTestConfirmationOperation[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > MAX_CONFIRMATION_OPERATIONS
  )
    return undefined;
  const operations: MatrixCorpusTestConfirmationOperation[] = [];
  const selectionKeys = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return undefined;
    const keys = Object.keys(candidate).sort();
    if (
      keys.length !== 4 ||
      keys[0] !== 'selectionOrdinal' ||
      keys[1] !== 'selectionTurnIndex' ||
      keys[2] !== 'toolArgs' ||
      keys[3] !== 'toolName'
    )
      return undefined;
    const toolName = candidate['toolName'];
    const toolArgs = candidate['toolArgs'];
    const selectionTurnIndex = candidate['selectionTurnIndex'];
    const selectionOrdinal = candidate['selectionOrdinal'];
    if (
      typeof toolName !== 'string' ||
      !toolNames.has(toolName) ||
      !isRecord(toolArgs) ||
      !Number.isInteger(selectionTurnIndex) ||
      Number(selectionTurnIndex) !== singular.selectionTurnIndex ||
      !Number.isInteger(selectionOrdinal) ||
      Number(selectionOrdinal) < 1 ||
      Number(selectionOrdinal) > 20
    )
      return undefined;
    const selectionKey = `${toolName}:${String(selectionTurnIndex)}:${String(selectionOrdinal)}`;
    if (selectionKeys.has(selectionKey)) return undefined;
    selectionKeys.add(selectionKey);
    operations.push({
      toolName: toolName as MatrixCorpusTestConfirmationOperation['toolName'],
      toolArgs: structuredClone(toolArgs),
      selectionTurnIndex: Number(selectionTurnIndex),
      selectionOrdinal: Number(selectionOrdinal),
    });
  }
  const first = operations[0];
  if (
    first?.toolName !== singular.toolName ||
    stableJson(first.toolArgs) !== stableJson(singular.toolArgs) ||
    first.selectionTurnIndex !== singular.selectionTurnIndex ||
    first.selectionOrdinal !== singular.selectionOrdinal
  )
    return undefined;
  return operations;
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
  const operations =
    input.operations === undefined
      ? undefined
      : parseConfirmationOperations(input.operations, input);
  return (
    isSafeId(input.identity.confirmationId) &&
    isSafeId(input.identity.runId) &&
    isSafeId(input.identity.scenarioId) &&
    isSafeId(input.identity.sessionId) &&
    isSafeId(input.identity.userId) &&
    fencePattern.test(input.identity.leaseFence) &&
    toolNames.has(input.toolName) &&
    isRecord(input.toolArgs) &&
    (input.operations === undefined || operations !== undefined) &&
    Buffer.byteLength(
      stableJson(confirmationPayload(input.toolArgs, operations)),
      'utf8'
    ) <= MAX_CONFIRMATION_PAYLOAD_BYTES &&
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
    runtimeAudience: 'hetzner-prod',
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
