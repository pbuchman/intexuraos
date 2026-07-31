import { createHash } from 'node:crypto';
import type {
  MessageDigestPreviousSummary,
  MessageDigestSourceMessage,
} from '@intexuraos/llm-prompts';
import type { MessageDigestDispatchOutbox, MessageDigestRun } from '../models/messageDigestRun.js';
import { getMessageDigestDeliveryOutboxId } from '../messageDigestIds.js';
import type {
  MessageDigestAggregator,
  MessageDigestWhatsAppClient,
  ValidatedMessageDigestSource,
} from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { isRetryableMessageDigestGenerationFailure } from './messageDigestRetryPolicy.js';

const LEASE_DURATION_MS = 180 * 1000;
const LEASE_HEARTBEAT_MS = 60 * 1000;
const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SOURCE_PAGE_LIMIT = 200;
const MAX_SOURCE_PAGES = 25;
const MAX_SOURCE_MESSAGES = 5_000;
const MAX_SOURCE_BYTES = 2_000_000;
const PREVIOUS_SUMMARY_LIMIT = 3;

export interface ProcessMessageDigestRunInput {
  userId: string;
  definitionId: string;
  runId: string;
  workerId: string;
}

export interface ProcessMessageDigestRunDependencies {
  store: Pick<
    MessageDigestStore,
    | 'claimRunLease'
    | 'renewRunLease'
    | 'markRunProcessingStage'
    | 'getOwnedRunContext'
    | 'listOwnedRuns'
    | 'completeRun'
    | 'failRun'
  >;
  whatsappClient: Pick<
    MessageDigestWhatsAppClient,
    'validateSource' | 'getDeliveryReadiness' | 'queryMessages'
  >;
  aggregator: MessageDigestAggregator;
  formatDelivery(run: MessageDigestRun):
    | { ok: true; value: { payloadJson: string; payloadDigest: string } }
    | { ok: false; code: string };
  dispatchOutbox(outboxId: string): Promise<unknown>;
  waitForHeartbeat?:
    | ((delayMs: number, signal: AbortSignal) => Promise<void>)
    | undefined;
  now?: (() => string) | undefined;
}

export type ProcessMessageDigestRunFailureCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_CHANGED'
  | 'SOURCE_TOO_LARGE'
  | 'READINESS_UNAVAILABLE'
  | 'DELIVERY_NOT_READY'
  | 'READINESS_CHANGED'
  | 'LLM_UNAVAILABLE'
  | 'INVALID_AGGREGATE'
  | 'DELIVERY_FORMAT_INVALID';

export type ProcessMessageDigestRunResult =
  | {
      ok: true;
      disposition: 'completed' | 'skipped_no_activity';
      run: MessageDigestRun;
    }
  | { ok: true; disposition: 'already_terminal' | 'deferred' }
  | { ok: false; code: ProcessMessageDigestRunFailureCode };

interface LeaseContext {
  userId: string;
  runId: string;
  ownerDigest: string;
  fence: number;
}

type RenewResult = { ok: true } | { ok: false; disposition: 'deferred' };

type ReadMessagesResult =
  | { ok: true; messages: MessageDigestSourceMessage[] }
  | {
      ok: false;
      code: 'SOURCE_NOT_FOUND' | 'SOURCE_UNAVAILABLE' | 'SOURCE_CHANGED' | 'SOURCE_TOO_LARGE';
    }
  | { ok: false; disposition: 'deferred' };

export async function processMessageDigestRun(
  input: ProcessMessageDigestRunInput,
  dependencies: ProcessMessageDigestRunDependencies
): Promise<ProcessMessageDigestRunResult> {
  const normalized = normalizeInput(input);
  const claimedAt = currentTime(dependencies);
  if (normalized === null || claimedAt === null) return { ok: false, code: 'INVALID_REQUEST' };

  const ownerDigest = digest(['message-digest-run-worker-owner-v1', normalized.workerId]);
  const claim = await dependencies.store.claimRunLease({
    userId: normalized.userId,
    runId: normalized.runId,
    ownerDigest,
    now: claimedAt,
    expiresAt: leaseExpiry(claimedAt),
  });
  if (!claim.ok) {
    if (claim.code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND' };
    if (claim.code === 'RUN_TERMINAL') return { ok: true, disposition: 'already_terminal' };
    return { ok: true, disposition: 'deferred' };
  }
  if (claim.disposition === 'existing') return { ok: true, disposition: 'deferred' };

  const lease: LeaseContext = {
    userId: normalized.userId,
    runId: normalized.runId,
    ownerDigest,
    fence: claim.fence,
  };
  const context = await dependencies.store.getOwnedRunContext(
    normalized.userId,
    normalized.definitionId
  );
  if (context === null) {
    return await recordFailure(dependencies, lease, 'NOT_FOUND');
  }
  if (!matchesReservedContext(context, claim.run, normalized)) {
    return { ok: true, disposition: 'deferred' };
  }

  const source = await dependencies.whatsappClient.validateSource({
    userId: normalized.userId,
    chatId: claim.run.sourceSnapshot.chatId,
    expectedGenerationId: claim.run.sourceSnapshot.generationId,
  });
  if (!source.ok) {
    return await recordFailure(dependencies, lease, mapSourceFailure(source.code));
  }
  if (!matchesSourceSnapshot(source.value, claim.run)) {
    return await recordFailure(dependencies, lease, 'SOURCE_CHANGED');
  }

  const readiness = await dependencies.whatsappClient.getDeliveryReadiness(normalized.userId);
  if (!readiness.ok) {
    return await recordFailure(dependencies, lease, 'READINESS_UNAVAILABLE');
  }
  if (readiness.value.status !== 'ready') {
    return await recordFailure(dependencies, lease, 'DELIVERY_NOT_READY');
  }
  if (
    readiness.value.observationVersion !==
    context.definition.delivery.readinessObservationVersion
  ) {
    return await recordFailure(dependencies, lease, 'READINESS_CHANGED');
  }

  const sourceMessages = await readFrozenMessagesWithOneRestart(
    dependencies,
    lease,
    source.value,
    claim.run
  );
  if (!sourceMessages.ok) {
    if ('disposition' in sourceMessages) return { ok: true, disposition: 'deferred' };
    return await recordFailure(dependencies, lease, sourceMessages.code);
  }

  const previousSummaries = await loadPreviousSummaries(
    dependencies.store,
    normalized.userId,
    normalized.definitionId,
    normalized.runId
  );
  const stageTime = currentTime(dependencies);
  if (stageTime === null) return await recordFailure(dependencies, lease, 'INVALID_REQUEST');
  const staged = await dependencies.store.markRunProcessingStage({
    ...lease,
    now: stageTime,
    processingStage: 'aggregating',
  });
  if (!staged.ok) return { ok: true, disposition: 'deferred' };
  const renewed = await renewLease(dependencies, lease);
  if (!renewed.ok) return { ok: true, disposition: 'deferred' };

  const aggregation = await runWithLeaseHeartbeat(
    dependencies.aggregator.aggregate({
      userId: normalized.userId,
      correlationId: normalized.runId,
      chatType: claim.run.sourceSnapshot.chatType,
      conversationLabel: claim.run.sourceSnapshot.displayName,
      windowStart: claim.run.windowStart,
      windowEnd: claim.run.windowEnd,
      instructions: claim.run.instructionsSnapshot.text,
      continuityMemoryMarkdown: context.state.continuityMemoryMarkdown,
      previousSummaries,
      messages: sourceMessages.messages,
    }),
    dependencies,
    lease
  );
  if (!aggregation.ok) return { ok: true, disposition: 'deferred' };
  const aggregated = aggregation.value;
  if (!aggregated.ok) {
    return await recordFailure(dependencies, lease, aggregated.code);
  }
  const afterAggregation = await renewLease(dependencies, lease);
  if (!afterAggregation.ok) return { ok: true, disposition: 'deferred' };

  const completedAt = currentTime(dependencies);
  if (completedAt === null) return await recordFailure(dependencies, lease, 'INVALID_REQUEST');
  if (aggregated.kind === 'empty') {
    if (aggregated.aggregate !== null) {
      return await recordFailure(dependencies, lease, 'INVALID_AGGREGATE');
    }
    const completed = await dependencies.store.completeRun({
      ...lease,
      completedAt,
      generationStatus: 'skipped_no_activity',
      output: {
        headline: null,
        summaryMarkdown: null,
        evidenceMessageRefs: [],
        continuityMemoryMarkdown: context.state.continuityMemoryMarkdown,
        effectiveMessageCount: 0,
        promptVersion: aggregated.metadata.promptVersion,
        model: aggregated.metadata.model,
        usage: aggregated.metadata.usage,
      },
    });
    return projectCompletion(completed);
  }

  const aggregate = aggregated.aggregate;
  if (aggregate === null) {
    return await recordFailure(dependencies, lease, 'INVALID_AGGREGATE');
  }
  const output = {
    headline: aggregate.headline,
    summaryMarkdown: aggregate.summaryMarkdown,
    evidenceMessageRefs: aggregate.evidenceMessageRefs,
    continuityMemoryMarkdown: aggregate.continuityMemoryMarkdown,
    effectiveMessageCount: aggregated.metadata.effectiveMessageCount,
    promptVersion: aggregated.metadata.promptVersion,
    model: aggregated.metadata.model,
    usage: aggregated.metadata.usage,
  };
  const completedCandidate: MessageDigestRun = {
    ...claim.run,
    generationStatus: 'completed',
    processingStage: 'completed',
    lease: null,
    ...output,
    delivery: {
      ...claim.run.delivery,
      status: 'pending',
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: completedAt,
      missingSince: null,
    },
    safeFailureCode: null,
    updatedAt: completedAt,
    completedAt,
  };
  const formatted = dependencies.formatDelivery(completedCandidate);
  if (!formatted.ok || !isValidFrozenPayload(formatted.value)) {
    return await recordFailure(dependencies, lease, 'DELIVERY_FORMAT_INVALID');
  }
  const deliveryOutbox = buildDeliveryOutbox({
    run: completedCandidate,
    completedAt,
    payloadJson: formatted.value.payloadJson,
    payloadDigest: formatted.value.payloadDigest,
  });
  const completed = await dependencies.store.completeRun({
    ...lease,
    completedAt,
    generationStatus: 'completed',
    output,
    deliveryOutbox,
  });
  const result = projectCompletion(completed);
  if (result.ok && result.disposition === 'completed') {
    await dependencies.dispatchOutbox(deliveryOutbox.outboxId);
  }
  return result;
}

async function readFrozenMessagesWithOneRestart(
  dependencies: ProcessMessageDigestRunDependencies,
  lease: LeaseContext,
  source: ValidatedMessageDigestSource,
  run: MessageDigestRun
): Promise<ReadMessagesResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await readFrozenMessages(dependencies, lease, source, run);
    if (result.ok || 'disposition' in result || result.code !== 'SOURCE_CHANGED') return result;
  }
  return { ok: false, code: 'SOURCE_CHANGED' };
}

async function readFrozenMessages(
  dependencies: ProcessMessageDigestRunDependencies,
  lease: LeaseContext,
  source: ValidatedMessageDigestSource,
  run: MessageDigestRun
): Promise<ReadMessagesResult> {
  const messages: MessageDigestSourceMessage[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let sourceRevision: string | undefined;
  let highWatermark: string | null | undefined;
  let sourceBytes = 0;

  for (let pageNumber = 0; pageNumber < MAX_SOURCE_PAGES; pageNumber += 1) {
    const beforeRead = await renewLease(dependencies, lease);
    if (!beforeRead.ok) return beforeRead;
    const pageRead = await runWithLeaseHeartbeat(
      dependencies.whatsappClient.queryMessages({
        userId: run.userId,
        sourceAccountId: source.sourceAccountId,
        generationId: source.generationId,
        chatId: source.chatId,
        chatType: source.chatType,
        windowStart: run.windowStart,
        windowEnd: run.windowEnd,
        limit: SOURCE_PAGE_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      }),
      dependencies,
      lease
    );
    if (!pageRead.ok) return { ok: false, disposition: 'deferred' };
    const page = pageRead.value;
    const afterRead = await renewLease(dependencies, lease);
    if (!afterRead.ok) return afterRead;
    if (!page.ok) return { ok: false, code: mapSourceFailure(page.code) };
    if (sourceRevision === undefined) {
      sourceRevision = page.value.sourceRevision;
      highWatermark = page.value.highWatermark;
    } else if (
      page.value.sourceRevision !== sourceRevision ||
      page.value.highWatermark !== highWatermark
    ) {
      return { ok: false, code: 'SOURCE_CHANGED' };
    }
    for (const message of page.value.messages) {
      sourceBytes += Buffer.byteLength(JSON.stringify(message), 'utf8');
      if (messages.length >= MAX_SOURCE_MESSAGES || sourceBytes > MAX_SOURCE_BYTES) {
        return { ok: false, code: 'SOURCE_TOO_LARGE' };
      }
      messages.push(message);
    }
    if (page.value.nextCursor === null) return { ok: true, messages };
    if (seenCursors.has(page.value.nextCursor)) return { ok: false, code: 'SOURCE_CHANGED' };
    seenCursors.add(page.value.nextCursor);
    cursor = page.value.nextCursor;
  }
  return { ok: false, code: 'SOURCE_TOO_LARGE' };
}

async function renewLease(
  dependencies: ProcessMessageDigestRunDependencies,
  lease: LeaseContext
): Promise<RenewResult> {
  const now = currentTime(dependencies);
  if (now === null) return { ok: false, disposition: 'deferred' };
  const renewed = await dependencies.store.renewRunLease({
    ...lease,
    now,
    expiresAt: leaseExpiry(now),
  });
  return renewed.ok ? { ok: true } : { ok: false, disposition: 'deferred' };
}

async function runWithLeaseHeartbeat<T>(
  operation: Promise<T>,
  dependencies: ProcessMessageDigestRunDependencies,
  lease: LeaseContext
): Promise<{ ok: true; value: T } | { ok: false }> {
  const abortController = new AbortController();
  const completed = operation.then((value) => ({ kind: 'completed' as const, value }));
  void completed.then(
    () => {
      abortController.abort();
    },
    () => {
      abortController.abort();
    }
  );
  const waitForHeartbeat = dependencies.waitForHeartbeat ?? waitForAbortableDelay;

  try {
    for (;;) {
      const next = await Promise.race([
        completed,
        waitForHeartbeat(LEASE_HEARTBEAT_MS, abortController.signal).then(() => ({
          kind: 'heartbeat' as const,
        })),
      ]);
      if (next.kind === 'completed') return { ok: true, value: next.value };
      const renewed = await renewLease(dependencies, lease);
      if (!renewed.ok) {
        await operation;
        return { ok: false };
      }
    }
  } finally {
    abortController.abort();
  }
}

async function waitForAbortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function loadPreviousSummaries(
  store: Pick<MessageDigestStore, 'listOwnedRuns'>,
  userId: string,
  definitionId: string,
  currentRunId: string
): Promise<MessageDigestPreviousSummary[]> {
  const history = await store.listOwnedRuns({
    userId,
    definitionId,
    limit: PREVIOUS_SUMMARY_LIMIT + 1,
    queryFingerprint: digest([
      'message-digest-worker-history-v1',
      userId,
      definitionId,
      currentRunId,
    ]),
  });
  return history.items
    .filter(isCompletedSummary)
    .filter((run) => run.runId !== currentRunId)
    .slice(0, PREVIOUS_SUMMARY_LIMIT)
    .map((run) => ({
      runId: run.runId,
      windowStart: run.windowStart,
      windowEnd: run.windowEnd,
      headline: run.headline,
      summaryMarkdown: run.summaryMarkdown,
      continuityMemoryMarkdown: run.continuityMemoryMarkdown,
    }))
    .reverse();
}

function isCompletedSummary(run: MessageDigestRun): run is MessageDigestRun & {
  headline: string;
  summaryMarkdown: string;
  continuityMemoryMarkdown: string;
} {
  return (
    run.generationStatus === 'completed' &&
    run.headline !== null &&
    run.summaryMarkdown !== null &&
    run.continuityMemoryMarkdown !== null
  );
}

async function recordFailure(
  dependencies: ProcessMessageDigestRunDependencies,
  lease: LeaseContext,
  code: ProcessMessageDigestRunFailureCode
): Promise<ProcessMessageDigestRunResult> {
  const failedAt = currentTime(dependencies);
  if (failedAt === null) return { ok: true, disposition: 'deferred' };
  const failed = await dependencies.store.failRun({
    ...lease,
    failedAt,
    safeFailureCode: code,
    pauseDefinition: !isRetryableMessageDigestGenerationFailure(code),
  });
  return failed.ok ? { ok: false, code } : { ok: true, disposition: 'deferred' };
}

function projectCompletion(
  completion: Awaited<ReturnType<MessageDigestStore['completeRun']>>
): ProcessMessageDigestRunResult {
  if (!completion.ok) {
    return completion.code === 'NOT_FOUND'
      ? { ok: false, code: 'NOT_FOUND' }
      : { ok: true, disposition: 'deferred' };
  }
  if (completion.run.generationStatus === 'skipped_no_activity') {
    return { ok: true, disposition: 'skipped_no_activity', run: completion.run };
  }
  if (completion.run.generationStatus === 'completed') {
    return { ok: true, disposition: 'completed', run: completion.run };
  }
  return { ok: true, disposition: 'deferred' };
}

function buildDeliveryOutbox(input: {
  run: MessageDigestRun;
  completedAt: string;
  payloadJson: string;
  payloadDigest: string;
}): MessageDigestDispatchOutbox {
  return {
    version: 1,
    outboxId: getMessageDigestDeliveryOutboxId(input.run.runId),
    userId: input.run.userId,
    definitionId: input.run.definitionId,
    runId: input.run.runId,
    kind: 'whatsapp_delivery',
    status: 'pending',
    payloadJson: input.payloadJson,
    payloadDigest: input.payloadDigest,
    attempts: 0,
    nextAttemptAt: input.completedAt,
    claim: null,
    publishedAt: null,
    terminalCode: null,
    createdAt: input.completedAt,
    updatedAt: input.completedAt,
    expiresAt: Math.floor((Date.parse(input.completedAt) + OUTBOX_RETENTION_MS) / 1000),
  };
}

function isValidFrozenPayload(value: { payloadJson: string; payloadDigest: string }): boolean {
  try {
    JSON.parse(value.payloadJson);
  } catch {
    return false;
  }
  return (
    /^[0-9a-f]{64}$/u.test(value.payloadDigest) &&
    createHash('sha256').update(value.payloadJson, 'utf8').digest('hex') === value.payloadDigest
  );
}

function matchesReservedContext(
  context: NonNullable<Awaited<ReturnType<MessageDigestStore['getOwnedRunContext']>>>,
  run: MessageDigestRun,
  input: ProcessMessageDigestRunInput
): boolean {
  const pending = context.state.pendingWindow;
  return (
    context.definition.status === 'active' &&
    run.userId === input.userId &&
    run.definitionId === input.definitionId &&
    context.definition.userId === input.userId &&
    context.definition.definitionId === input.definitionId &&
    context.state.userId === input.userId &&
    context.state.definitionId === input.definitionId &&
    pending !== null &&
    pending.runId === run.runId &&
    pending.windowStart === run.windowStart &&
    pending.windowEnd === run.windowEnd &&
    pending.erasureEpoch === context.definition.erasureEpoch
  );
}

function matchesSourceSnapshot(source: ValidatedMessageDigestSource, run: MessageDigestRun): boolean {
  return (
    source.sourceAccountId === run.sourceSnapshot.sourceAccountId &&
    source.generationId === run.sourceSnapshot.generationId &&
    source.chatId === run.sourceSnapshot.chatId &&
    source.chatType === run.sourceSnapshot.chatType
  );
}

function mapSourceFailure(
  code: 'invalid_request' | 'unavailable' | 'source_changed' | 'not_found' | 'invalid_response'
): 'SOURCE_NOT_FOUND' | 'SOURCE_UNAVAILABLE' | 'SOURCE_CHANGED' {
  if (code === 'source_changed') return 'SOURCE_CHANGED';
  if (code === 'not_found') return 'SOURCE_NOT_FOUND';
  return 'SOURCE_UNAVAILABLE';
}

function normalizeInput(input: ProcessMessageDigestRunInput): ProcessMessageDigestRunInput | null {
  const userId = input.userId.trim();
  const definitionId = input.definitionId.trim();
  const runId = input.runId.trim();
  const workerId = input.workerId.trim();
  if (
    userId === '' ||
    userId.length > 256 ||
    !/^md_[A-Za-z0-9_-]{3,120}$/u.test(definitionId) ||
    !/^mdr_[A-Za-z0-9_-]{3,160}$/u.test(runId) ||
    workerId === '' ||
    workerId.length > 256
  ) {
    return null;
  }
  return { userId, definitionId, runId, workerId };
}

function currentTime(dependencies: ProcessMessageDigestRunDependencies): string | null {
  const value = dependencies.now?.() ?? new Date().toISOString();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function leaseExpiry(now: string): string {
  return new Date(Date.parse(now) + LEASE_DURATION_MS).toISOString();
}

function digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part.length.toString(10)).update(':').update(part);
  return hash.digest('hex');
}
