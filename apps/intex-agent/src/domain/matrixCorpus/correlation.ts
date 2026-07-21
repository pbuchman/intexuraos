const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_REPLIES_PER_TURN = 5;

export interface MatrixCorpusReplyPublicationV1 {
  replyIndex: number;
  replyDigest: string;
  idempotencyKeyDigest: string;
  state: 'reserved' | 'accepted';
  publicationReceiptDigest: string | null;
  reservedAt: string;
  acceptedAt: string | null;
}

export type MatrixCorpusTurnTerminalV1 =
  | Readonly<{
      kind: 'completed';
      replyCount: number;
      replyDigests: readonly string[];
      publicationReceiptDigests: readonly string[];
      closedAt: string;
    }>
  | Readonly<{
      kind: 'failed';
      code: 'AMBIGUOUS_EXTERNAL_EFFECT' | 'REPLY_PUBLICATION_REJECTED' | 'EXECUTION_REJECTED';
      closedAt: string;
    }>;

export interface MatrixCorpusTurnPublicationV1 {
  version: 1;
  phase: 'open' | 'completing' | 'closed';
  expectedReplyDigests: readonly string[] | null;
  replies: readonly MatrixCorpusReplyPublicationV1[];
  terminal: MatrixCorpusTurnTerminalV1 | null;
}

export type MatrixCorpusCorrelationFailureCode =
  | 'INVALID_CORRELATION'
  | 'INVALID_STATE'
  | 'OUT_OF_ORDER_REPLY'
  | 'UNBOUND_REPLY'
  | 'REPLY_LIMIT_EXCEEDED'
  | 'CORRELATED_REPLAY_CONFLICT';

export type MatrixCorpusCorrelationMutationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      publication: MatrixCorpusTurnPublicationV1;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusCorrelationFailureCode }>;

export type MatrixCorpusCorrelationRecoveryResult =
  | Readonly<{
      ok: true;
      disposition: 'completed_recovered' | 'failed_ambiguous' | 'terminal';
      publication: MatrixCorpusTurnPublicationV1;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusCorrelationFailureCode }>;

export function createOpenTurnPublication(): MatrixCorpusTurnPublicationV1 {
  return { version: 1, phase: 'open', expectedReplyDigests: null, replies: [], terminal: null };
}

export function beginTurnCompletion(
  current: MatrixCorpusTurnPublicationV1,
  input: Readonly<{ expectedReplyDigests: readonly string[]; now: string }>
): MatrixCorpusCorrelationMutationResult {
  if (!isValidTimestamp(input.now) || !isValidExpectedDigests(input.expectedReplyDigests))
    return failure('INVALID_CORRELATION');
  if (!isValidPublication(current)) return failure('INVALID_CORRELATION');
  if (current.phase === 'open')
    return success('applied', {
      ...current,
      phase: 'completing',
      expectedReplyDigests: [...input.expectedReplyDigests],
    });
  if (sameStrings(current.expectedReplyDigests, input.expectedReplyDigests))
    return success('already_applied', current);
  return failure('CORRELATED_REPLAY_CONFLICT');
}

export function reserveReplyPublication(
  current: MatrixCorpusTurnPublicationV1,
  input: Readonly<{
    replyIndex: number;
    replyDigest: string;
    idempotencyKeyDigest: string;
    now: string;
  }>
): MatrixCorpusCorrelationMutationResult {
  if (!isValidPublication(current) || !isValidReplyInput(input))
    return failure('INVALID_CORRELATION');
  if (input.replyIndex >= MAX_REPLIES_PER_TURN) return failure('REPLY_LIMIT_EXCEEDED');
  if (current.phase !== 'completing' || current.expectedReplyDigests === null)
    return failure('INVALID_STATE');
  const existing = current.replies[input.replyIndex];
  if (existing !== undefined)
    return existing.replyDigest === input.replyDigest &&
      existing.idempotencyKeyDigest === input.idempotencyKeyDigest
      ? success('already_applied', current)
      : failure('CORRELATED_REPLAY_CONFLICT');
  if (input.replyIndex !== current.replies.length) return failure('OUT_OF_ORDER_REPLY');
  if (current.expectedReplyDigests[input.replyIndex] !== input.replyDigest)
    return failure('UNBOUND_REPLY');
  return success('applied', {
    ...current,
    replies: [
      ...current.replies,
      {
        replyIndex: input.replyIndex,
        replyDigest: input.replyDigest,
        idempotencyKeyDigest: input.idempotencyKeyDigest,
        state: 'reserved',
        publicationReceiptDigest: null,
        reservedAt: input.now,
        acceptedAt: null,
      },
    ],
  });
}

export function acceptReplyPublication(
  current: MatrixCorpusTurnPublicationV1,
  input: Readonly<{
    replyIndex: number;
    replyDigest: string;
    idempotencyKeyDigest: string;
    publicationReceiptDigest: string;
    now: string;
  }>
): MatrixCorpusCorrelationMutationResult {
  if (
    !isValidPublication(current) ||
    !isValidReplyInput(input) ||
    !SHA_256_PATTERN.test(input.publicationReceiptDigest)
  )
    return failure('INVALID_CORRELATION');
  if (current.phase !== 'completing') return failure('INVALID_STATE');
  const existing = current.replies[input.replyIndex];
  if (existing === undefined) return failure('OUT_OF_ORDER_REPLY');
  if (
    existing.replyDigest !== input.replyDigest ||
    existing.idempotencyKeyDigest !== input.idempotencyKeyDigest
  )
    return failure('CORRELATED_REPLAY_CONFLICT');
  if (existing.state === 'accepted')
    return existing.publicationReceiptDigest === input.publicationReceiptDigest
      ? success('already_applied', current)
      : failure('CORRELATED_REPLAY_CONFLICT');
  const replies = current.replies.map((reply) =>
    reply.replyIndex === input.replyIndex
      ? {
          ...reply,
          state: 'accepted' as const,
          publicationReceiptDigest: input.publicationReceiptDigest,
          acceptedAt: input.now,
        }
      : reply
  );
  return success('applied', { ...current, replies });
}

export function closeTurnCompleted(
  current: MatrixCorpusTurnPublicationV1,
  input: Readonly<{ now: string }>
): MatrixCorpusCorrelationMutationResult {
  if (!isValidPublication(current) || !isValidTimestamp(input.now))
    return failure('INVALID_CORRELATION');
  if (current.phase === 'closed')
    return current.terminal?.kind === 'completed'
      ? success('already_applied', current)
      : failure('CORRELATED_REPLAY_CONFLICT');
  if (!isCompletionReady(current)) return failure('INVALID_STATE');
  const publicationReceiptDigests = current.replies.map(
    (reply) => reply.publicationReceiptDigest
  );
  /* v8 ignore start -- upstream: isCompletionReady validates every receipt digest as non-null immediately before this guard, so the invalid branch cannot be reached @preserve */
  if (publicationReceiptDigests.some((digest) => digest === null))
    return failure('INVALID_STATE');
  /* v8 ignore stop @preserve */
  return success('applied', {
    ...current,
    phase: 'closed',
    terminal: {
      kind: 'completed',
      replyCount: current.replies.length,
      /* v8 ignore start -- ts-type: isCompletionReady guarantees expectedReplyDigests is non-null; nullish coalescing remains for TypeScript narrowing across the helper @preserve */
      replyDigests: [...(current.expectedReplyDigests ?? [])],
      /* v8 ignore stop @preserve */
      publicationReceiptDigests: publicationReceiptDigests as string[],
      closedAt: input.now,
    },
  });
}

export function closeTurnFailed(
  current: MatrixCorpusTurnPublicationV1,
  input: Readonly<{
    code: Extract<MatrixCorpusTurnTerminalV1, { kind: 'failed' }>['code'];
    now: string;
  }>
): MatrixCorpusCorrelationMutationResult {
  if (!isValidPublication(current) || !isValidTimestamp(input.now))
    return failure('INVALID_CORRELATION');
  if (current.phase === 'closed')
    return current.terminal?.kind === 'failed' && current.terminal.code === input.code
      ? success('already_applied', current)
      : failure('CORRELATED_REPLAY_CONFLICT');
  return success('applied', {
    ...current,
    phase: 'closed',
    terminal: { kind: 'failed', code: input.code, closedAt: input.now },
  });
}

export function recoverInterruptedTurn(
  current: MatrixCorpusTurnPublicationV1,
  input: Readonly<{ now: string }>
): MatrixCorpusCorrelationRecoveryResult {
  if (!isValidPublication(current) || !isValidTimestamp(input.now))
    return failure('INVALID_CORRELATION');
  if (current.phase === 'closed')
    return { ok: true, disposition: 'terminal', publication: clonePublication(current) };
  if (isCompletionReady(current)) {
    const completed = closeTurnCompleted(current, input);
    /* v8 ignore start -- upstream: isCompletionReady plus the already validated timestamp guarantees closeTurnCompleted succeeds; its failure arm cannot be produced here @preserve */
    return completed.ok
      ? {
          ok: true,
          disposition: 'completed_recovered',
          publication: completed.publication,
        }
      : completed;
    /* v8 ignore stop @preserve */
  }
  const failed = closeTurnFailed(current, { code: 'AMBIGUOUS_EXTERNAL_EFFECT', now: input.now });
  /* v8 ignore start -- upstream: publication and timestamp were validated and the closed phase returned above, so closeTurnFailed always succeeds for this fixed code @preserve */
  return failed.ok
    ? { ok: true, disposition: 'failed_ambiguous', publication: failed.publication }
    : failed;
  /* v8 ignore stop @preserve */
}

export function isValidTurnPublication(value: unknown): value is MatrixCorpusTurnPublicationV1 {
  return isValidPublication(value);
}

function isCompletionReady(publication: MatrixCorpusTurnPublicationV1): boolean {
  return (
    publication.phase === 'completing' &&
    publication.expectedReplyDigests !== null &&
    publication.replies.length === publication.expectedReplyDigests.length &&
    publication.replies.every(
      (reply, index) =>
        reply.replyIndex === index &&
        reply.replyDigest === publication.expectedReplyDigests?.[index] &&
        reply.state === 'accepted' &&
        reply.publicationReceiptDigest !== null
    )
  );
}

function isValidPublication(value: unknown): value is MatrixCorpusTurnPublicationV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    record['version'] !== 1 ||
    (record['phase'] !== 'open' &&
      record['phase'] !== 'completing' &&
      record['phase'] !== 'closed') ||
    !Array.isArray(record['replies']) ||
    record['replies'].length > MAX_REPLIES_PER_TURN
  )
    return false;
  const expected = record['expectedReplyDigests'];
  if (expected !== null && !isValidExpectedDigests(expected)) return false;
  if (record['phase'] === 'open' && (expected !== null || record['replies'].length !== 0))
    return false;
  if (record['phase'] === 'completing' && expected === null) return false;
  if (!record['replies'].every(isValidReplyPublication)) return false;
  const terminal = record['terminal'];
  if (record['phase'] === 'closed')
    return (
      isValidTerminal(terminal) &&
      (terminal.kind === 'failed' || expected !== null)
    );
  return terminal === null;
}

function isValidReplyPublication(value: unknown): value is MatrixCorpusReplyPublicationV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const reply = value as Record<string, unknown>;
  return (
    Number.isInteger(reply['replyIndex']) &&
    Number(reply['replyIndex']) >= 0 &&
    Number(reply['replyIndex']) < MAX_REPLIES_PER_TURN &&
    typeof reply['replyDigest'] === 'string' &&
    SHA_256_PATTERN.test(reply['replyDigest']) &&
    typeof reply['idempotencyKeyDigest'] === 'string' &&
    SHA_256_PATTERN.test(reply['idempotencyKeyDigest']) &&
    (reply['state'] === 'reserved' || reply['state'] === 'accepted') &&
    isValidTimestamp(reply['reservedAt']) &&
    ((reply['state'] === 'reserved' &&
      reply['publicationReceiptDigest'] === null &&
      reply['acceptedAt'] === null) ||
      (reply['state'] === 'accepted' &&
        typeof reply['publicationReceiptDigest'] === 'string' &&
        SHA_256_PATTERN.test(reply['publicationReceiptDigest']) &&
        isValidTimestamp(reply['acceptedAt'])))
  );
}

function isValidTerminal(value: unknown): value is MatrixCorpusTurnTerminalV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const terminal = value as Record<string, unknown>;
  if (!isValidTimestamp(terminal['closedAt'])) return false;
  if (terminal['kind'] === 'failed')
    return (
      terminal['code'] === 'AMBIGUOUS_EXTERNAL_EFFECT' ||
      terminal['code'] === 'REPLY_PUBLICATION_REJECTED' ||
      terminal['code'] === 'EXECUTION_REJECTED'
    );
  return (
    terminal['kind'] === 'completed' &&
    Number.isInteger(terminal['replyCount']) &&
    Number(terminal['replyCount']) >= 1 &&
    Number(terminal['replyCount']) <= MAX_REPLIES_PER_TURN &&
    isValidExpectedDigests(terminal['replyDigests']) &&
    Array.isArray(terminal['publicationReceiptDigests']) &&
    terminal['publicationReceiptDigests'].length === terminal['replyCount'] &&
    terminal['publicationReceiptDigests'].every(
      (digest) => typeof digest === 'string' && SHA_256_PATTERN.test(digest)
    )
  );
}

function isValidExpectedDigests(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_REPLIES_PER_TURN &&
    value.every((digest) => typeof digest === 'string' && SHA_256_PATTERN.test(digest)) &&
    new Set(value).size === value.length
  );
}

function isValidReplyInput(input: Readonly<{
  replyIndex: number;
  replyDigest: string;
  idempotencyKeyDigest: string;
  now: string;
}>): boolean {
  return (
    Number.isInteger(input.replyIndex) &&
    input.replyIndex >= 0 &&
    SHA_256_PATTERN.test(input.replyDigest) &&
    SHA_256_PATTERN.test(input.idempotencyKeyDigest) &&
    isValidTimestamp(input.now)
  );
}

function sameStrings(left: readonly string[] | null, right: readonly string[]): boolean {
  return left !== null && left.length === right.length && left.every((value, index) => value === right[index]);
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function success(
  disposition: 'applied' | 'already_applied',
  publication: MatrixCorpusTurnPublicationV1
): MatrixCorpusCorrelationMutationResult {
  return { ok: true, disposition, publication: clonePublication(publication) };
}

function failure(code: MatrixCorpusCorrelationFailureCode): Readonly<{
  ok: false;
  code: MatrixCorpusCorrelationFailureCode;
}> {
  return { ok: false, code };
}

function clonePublication(
  publication: MatrixCorpusTurnPublicationV1
): MatrixCorpusTurnPublicationV1 {
  return structuredClone(publication);
}
