import { createHash } from 'node:crypto';
import { FieldPath, type Firestore } from '@intexuraos/infra-firestore';
import { getMessageDigestDeliveryOutboxId } from '../../domain/messageDigestIds.js';
import type {
  DefinitionUpdatePatch,
  MessageDigestCompletionOutput,
  MessageDigestStore,
  ReserveRunInput,
} from '../../domain/ports/messageDigestStore.js';
import {
  canTransitionMessageDigestDefinitionStatus,
  MESSAGE_DIGEST_DEFINITIONS_COLLECTION,
  MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION,
  MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION,
  MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION,
  MESSAGE_DIGEST_RUNS_COLLECTION,
  MESSAGE_DIGEST_STATES_COLLECTION,
  MessageDigestDefinitionDocumentSchema,
  MessageDigestDispatchOutboxDocumentSchema,
  MessageDigestErasureRequestDocumentSchema,
  MessageDigestMigrationActivationDocumentSchema,
  MessageDigestRunDocumentSchema,
  MessageDigestStateDocumentSchema,
  type MessageDigestCursorCodec,
  type MessageDigestDefinitionDocument,
  type MessageDigestDispatchOutboxDocument,
  type MessageDigestErasureRequestDocument,
  type MessageDigestRunDocument,
  type MessageDigestStateDocument,
} from './messageDigestDocuments.js';
import {
  createFirestoreLegacyDigestArchive,
  type FirestoreLegacyDigestArchive,
} from './firestoreLegacyDigestArchive.js';

interface StoreConfig {
  firestore: Firestore;
  cursorCodec: MessageDigestCursorCodec;
}

export class FirestoreMessageDigestStore implements MessageDigestStore {
  private readonly legacyArchive: FirestoreLegacyDigestArchive;

  constructor(private readonly config: StoreConfig) {
    this.legacyArchive = createFirestoreLegacyDigestArchive({ firestore: config.firestore });
  }

  async createDefinition(input: {
    definition: MessageDigestDefinitionDocument;
    state: MessageDigestStateDocument;
  }): Promise<
    | {
        ok: true;
        disposition: 'created' | 'existing';
        definition: MessageDigestDefinitionDocument;
      }
    | { ok: false; code: 'CREATE_CONFLICT' }
  > {
    const definition = MessageDigestDefinitionDocumentSchema.parse(input.definition);
    const state = MessageDigestStateDocumentSchema.parse(input.state);
    if (
      definition.definitionId !== state.definitionId ||
      definition.userId !== state.userId ||
      definition.checkpointAt !== state.checkpointAt
    ) {
      return { ok: false, code: 'CREATE_CONFLICT' };
    }
    const definitionRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(definition.definitionId);
    const stateRef = this.config.firestore
      .collection(MESSAGE_DIGEST_STATES_COLLECTION)
      .doc(state.definitionId);

    return await this.config.firestore.runTransaction(async (transaction) => {
      const [definitionSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(stateRef),
      ]);
      if (definitionSnapshot.exists) {
        const existing = parseDefinition(definitionSnapshot.data());
        if (
          existing.userId !== definition.userId ||
          existing.createRequestIdDigest !== definition.createRequestIdDigest ||
          !stateSnapshot.exists
        ) {
          return { ok: false as const, code: 'CREATE_CONFLICT' as const };
        }
        parseState(stateSnapshot.data());
        return {
          ok: true as const,
          disposition: 'existing' as const,
          definition: existing,
        };
      }
      if (stateSnapshot.exists) return { ok: false as const, code: 'CREATE_CONFLICT' as const };
      transaction.set(definitionRef, definition);
      transaction.set(stateRef, state);
      return { ok: true as const, disposition: 'created' as const, definition };
    });
  }

  async getOwnedDefinition(
    userId: string,
    definitionId: string
  ): Promise<MessageDigestDefinitionDocument | null> {
    const snapshot = await this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(definitionId)
      .get();
    if (!snapshot.exists) return null;
    const definition = parseDefinition(snapshot.data());
    return definition.userId === userId && definition.status !== 'migrating' ? definition : null;
  }

  async getOwnedDefinitionByLegacyAlias(input: {
    userId: string;
    legacyGroupKey: string;
  }): Promise<MessageDigestDefinitionDocument | null> {
    if (
      input.userId.trim() === '' ||
      input.userId.length > 256 ||
      input.legacyGroupKey.length < 1 ||
      input.legacyGroupKey.length > 128 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.legacyGroupKey)
    ) {
      return null;
    }
    const snapshot = await this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .where('userId', '==', input.userId)
      .where('legacyAlias.groupKey', '==', input.legacyGroupKey)
      .where('status', 'in', ['active', 'paused'])
      .get();
    const definitions = snapshot.docs
      .map((document) => parseDefinition(document.data()))
      .filter(
        (definition) =>
          definition.userId === input.userId &&
          definition.legacyAlias?.groupKey === input.legacyGroupKey &&
          definition.activeMigrationId !== null &&
          definition.source.chatType === 'group' &&
          (definition.status === 'active' || definition.status === 'paused')
      );
    if (definitions.length > 1) throw new Error('AMBIGUOUS_LEGACY_ALIAS');
    return definitions[0] ?? null;
  }

  async getOwnedRunContext(
    userId: string,
    definitionId: string
  ): Promise<{
    definition: MessageDigestDefinitionDocument;
    state: MessageDigestStateDocument;
  } | null> {
    const definitionRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(definitionId);
    const stateRef = this.config.firestore
      .collection(MESSAGE_DIGEST_STATES_COLLECTION)
      .doc(definitionId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const [definitionSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(stateRef),
      ]);
      if (!definitionSnapshot.exists || !stateSnapshot.exists) return null;
      const definition = parseDefinition(definitionSnapshot.data());
      const state = parseState(stateSnapshot.data());
      if (
        definition.userId !== userId ||
        state.userId !== userId ||
        state.definitionId !== definition.definitionId ||
        definition.status === 'migrating'
      ) {
        return null;
      }
      return { definition, state };
    });
  }

  async listOwnedDefinitions(input: {
    userId: string;
    query?: string | undefined;
    chatType?: 'group' | 'direct' | undefined;
    status?: 'active' | 'paused' | 'needs_attention' | undefined;
    sort?: 'name' | 'updatedAt' | 'nextRunAt' | undefined;
    direction?: 'asc' | 'desc' | undefined;
    limit: number;
    cursor?: string | undefined;
    queryFingerprint: string;
  }): Promise<{ items: MessageDigestDefinitionDocument[]; nextCursor: string | null }> {
    assertLimit(input.limit);
    const sort = input.sort ?? 'updatedAt';
    const direction = input.direction ?? (sort === 'name' ? 'asc' : 'desc');
    if (input.query !== undefined && sort !== 'name') throw new Error('INVALID_QUERY');
    const sortField = sort === 'name' ? 'nameSortKey' : sort;
    let query = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .where('userId', '==', input.userId);
    if (input.status === 'active' || input.status === 'paused') {
      query = query.where('status', '==', input.status).where('listStatus', '==', input.status);
    } else {
      query = query.where('status', 'in', ['active', 'paused']);
      if (input.status === 'needs_attention') {
        query = query.where('listStatus', '==', 'needs_attention');
      }
    }
    if (input.chatType !== undefined) {
      query = query.where('source.chatType', '==', input.chatType);
    }
    if (input.query !== undefined) {
      query = query
        .where('nameSortKey', '>=', input.query)
        .where('nameSortKey', '<', `${input.query}\uf8ff`);
    }
    query = query.orderBy(sortField, direction).orderBy(FieldPath.documentId(), direction);
    if (input.cursor !== undefined) {
      const cursor = this.config.cursorCodec.read(input.cursor, {
        kind: 'definitions',
        queryFingerprint: input.queryFingerprint,
      });
      if (!cursor.ok || cursor.value.length !== 2) throw new Error('INVALID_CURSOR');
      query = query.startAfter(...cursor.value);
    }
    const snapshot = await query.limit(input.limit + 1).get();
    const parsed = snapshot.docs.map((document) => parseDefinition(document.data()));
    const items = parsed.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        parsed.length > input.limit && last !== undefined
          ? this.config.cursorCodec.issue({
              kind: 'definitions',
              queryFingerprint: input.queryFingerprint,
              values: [definitionSortValue(last, sort), last.definitionId],
            })
          : null,
    };
  }

  async listDueDefinitions(input: {
    now: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<{ items: MessageDigestDefinitionDocument[]; nextCursor: string | null }> {
    assertLimit(input.limit);
    assertTimestamp(input.now);
    const queryFingerprint = digestJson({ kind: 'due_definitions' });
    let evaluatedAt = input.now;
    let startAfter: [string, string] | null = null;
    if (input.cursor !== undefined) {
      const cursor = this.config.cursorCodec.read(input.cursor, {
        kind: 'due_definitions',
        queryFingerprint,
      });
      const [cursorEvaluatedAt, cursorNextRunAt, cursorDefinitionId] = cursor.ok
        ? cursor.value
        : [];
      if (
        !cursor.ok ||
        cursor.value.length !== 3 ||
        !isTimestampCursorValue(cursorEvaluatedAt) ||
        !isTimestampCursorValue(cursorNextRunAt) ||
        !isDefinitionIdCursorValue(cursorDefinitionId)
      ) {
        throw new Error('INVALID_CURSOR');
      }
      evaluatedAt = cursorEvaluatedAt;
      startAfter = [cursorNextRunAt, cursorDefinitionId];
    }
    let query = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .where('status', '==', 'active')
      .where('nextRunAt', '<=', evaluatedAt)
      .orderBy('nextRunAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc');
    if (startAfter !== null) query = query.startAfter(...startAfter);
    const snapshot = await query.limit(input.limit + 1).get();
    const parsed = snapshot.docs.map((document) => parseDefinition(document.data()));
    const items = parsed.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        parsed.length > input.limit && last !== undefined
          ? this.config.cursorCodec.issue({
              kind: 'due_definitions',
              queryFingerprint,
              values: [evaluatedAt, last.nextRunAt, last.definitionId],
            })
          : null,
    };
  }

  async listReadyDispatches(input: {
    now: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<{ items: MessageDigestDispatchOutboxDocument[]; nextCursor: string | null }> {
    assertTimestamp(input.now);
    assertLimit(input.limit);
    const queryFingerprint = digestJson({ kind: 'ready_dispatches', now: input.now });
    let query = this.config.firestore
      .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
      .where('status', '==', 'pending')
      .where('nextAttemptAt', '<=', input.now)
      .orderBy('nextAttemptAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc');
    if (input.cursor !== undefined) {
      const cursor = this.config.cursorCodec.read(input.cursor, {
        kind: 'ready_dispatches',
        queryFingerprint,
      });
      if (!cursor.ok || cursor.value.length !== 2) throw new Error('INVALID_CURSOR');
      query = query.startAfter(...cursor.value);
    }
    const snapshot = await query.limit(input.limit + 1).get();
    const parsed = snapshot.docs.map((document) => parseOutbox(document.data()));
    const items = parsed.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        parsed.length > input.limit && last !== undefined
          ? this.config.cursorCodec.issue({
              kind: 'ready_dispatches',
              queryFingerprint,
              values: [last.nextAttemptAt, last.outboxId],
            })
          : null,
    };
  }

  async listPendingDeliveryRuns(input: {
    now: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<{ items: MessageDigestRunDocument[]; nextCursor: string | null }> {
    assertTimestamp(input.now);
    assertLimit(input.limit);
    const queryFingerprint = digestJson({ kind: 'pending_deliveries', now: input.now });
    let query = this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .where('recordRole', '==', 'canonical')
      .where('visibilityMigrationId', '==', null)
      .where('generationStatus', '==', 'completed')
      .where('delivery.status', '==', 'pending')
      .where('delivery.nextCheckAt', '<=', input.now)
      .orderBy('delivery.nextCheckAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc');
    if (input.cursor !== undefined) {
      const cursor = this.config.cursorCodec.read(input.cursor, {
        kind: 'pending_deliveries',
        queryFingerprint,
      });
      if (!cursor.ok || cursor.value.length !== 2) throw new Error('INVALID_CURSOR');
      query = query.startAfter(...cursor.value);
    }
    const snapshot = await query.limit(input.limit + 1).get();
    const parsed = snapshot.docs.map((document) => parseRun(document.data()));
    const items = parsed.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        parsed.length > input.limit && last !== undefined
          ? this.config.cursorCodec.issue({
              kind: 'pending_deliveries',
              queryFingerprint,
              values: [last.delivery.nextCheckAt, last.runId],
            })
          : null,
    };
  }

  async updateDefinition(input: {
    userId: string;
    definitionId: string;
    expectedRevision: number;
    updatedAt: string;
    patch: DefinitionUpdatePatch;
  }): Promise<
    | { ok: true; definition: MessageDigestDefinitionDocument }
    | {
        ok: false;
        code:
          | 'NOT_FOUND'
          | 'REVISION_CONFLICT'
          | 'INVALID_TRANSITION'
          | 'SOURCE_LOCKED'
          | 'RUN_IN_PROGRESS';
      }
  > {
    assertTimestamp(input.updatedAt);
    const definitionRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(input.definitionId);
    const stateRef = this.config.firestore
      .collection(MESSAGE_DIGEST_STATES_COLLECTION)
      .doc(input.definitionId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const [definitionSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(stateRef),
      ]);
      if (!definitionSnapshot.exists || !stateSnapshot.exists) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const state = parseState(stateSnapshot.data());
      if (definition.userId !== input.userId || state.userId !== input.userId) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      if (definition.revision !== input.expectedRevision) {
        return { ok: false as const, code: 'REVISION_CONFLICT' as const };
      }
      if (definition.status === 'deleting') {
        return { ok: false as const, code: 'INVALID_TRANSITION' as const };
      }
      const nextStatus = input.patch.status ?? definition.status;
      if (!canTransitionMessageDigestDefinitionStatus(definition.status, nextStatus)) {
        return { ok: false as const, code: 'INVALID_TRANSITION' as const };
      }
      if (
        definition.status === 'active' &&
        nextStatus === 'paused' &&
        state.pendingWindow !== null
      ) {
        return { ok: false as const, code: 'RUN_IN_PROGRESS' as const };
      }
      if (
        input.patch.source !== undefined &&
        (definition.hasRuns || state.pendingWindow !== null)
      ) {
        return { ok: false as const, code: 'SOURCE_LOCKED' as const };
      }
      if (
        input.patch.source !== undefined &&
        (input.patch.resetCheckpointAt === undefined || input.patch.nextRunAt === undefined)
      ) {
        return { ok: false as const, code: 'SOURCE_LOCKED' as const };
      }

      let releaseFailedPendingWindow = false;
      if (
        input.patch.releaseFailedPendingWindow === true &&
        definition.status === 'paused' &&
        definition.listStatus === 'needs_attention' &&
        state.pendingWindow !== null
      ) {
        const pendingRunSnapshot = await transaction.get(
          this.config.firestore
            .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
            .doc(state.pendingWindow.runId)
        );
        if (!pendingRunSnapshot.exists) {
          return { ok: false as const, code: 'INVALID_TRANSITION' as const };
        }
        const pendingRun = parseRun(pendingRunSnapshot.data());
        if (
          pendingRun.userId !== input.userId ||
          pendingRun.definitionId !== input.definitionId ||
          pendingRun.runId !== state.pendingWindow.runId ||
          pendingRun.generationStatus !== 'failed' ||
          pendingRun.processingStage !== 'failed' ||
          pendingRun.lease !== null
        ) {
          return { ok: false as const, code: 'INVALID_TRANSITION' as const };
        }
        releaseFailedPendingWindow = true;
      }

      const defaultListStatus = nextStatus === 'active' ? ('active' as const) : ('paused' as const);
      const nextListStatus =
        input.patch.listStatus ??
        (input.patch.status === undefined ? definition.listStatus : defaultListStatus);
      const nextAttentionCode =
        input.patch.attentionCode !== undefined
          ? input.patch.attentionCode
          : input.patch.listStatus === undefined && input.patch.status === undefined
            ? definition.attentionCode
            : nextListStatus === 'needs_attention'
              ? definition.attentionCode
              : null;
      const nextDefinition = MessageDigestDefinitionDocumentSchema.parse({
        ...definition,
        ...(input.patch.name === undefined ? {} : { name: input.patch.name }),
        ...(input.patch.nameSortKey === undefined ? {} : { nameSortKey: input.patch.nameSortKey }),
        ...(input.patch.source === undefined ? {} : { source: input.patch.source }),
        ...(input.patch.instructions === undefined
          ? {}
          : { instructions: input.patch.instructions }),
        ...(input.patch.schedule === undefined ? {} : { schedule: input.patch.schedule }),
        ...(input.patch.delivery === undefined ? {} : { delivery: input.patch.delivery }),
        status: nextStatus,
        listStatus: nextListStatus,
        attentionCode: nextAttentionCode,
        checkpointAt: input.patch.resetCheckpointAt ?? definition.checkpointAt,
        nextRunAt: input.patch.nextRunAt ?? definition.nextRunAt,
        revision: definition.revision + 1,
        updatedAt: input.updatedAt,
      });
      transaction.set(definitionRef, nextDefinition);
      if (input.patch.source !== undefined && input.patch.resetCheckpointAt !== undefined) {
        const nextState = MessageDigestStateDocumentSchema.parse({
          ...state,
          revision: state.revision + 1,
          checkpointAt: input.patch.resetCheckpointAt,
          continuityMemoryMarkdown: '',
          precedingRunId: null,
          precedingRunHash: null,
          pendingWindow: null,
          updatedAt: input.updatedAt,
        });
        transaction.set(stateRef, nextState);
      } else if (releaseFailedPendingWindow) {
        const nextState = MessageDigestStateDocumentSchema.parse({
          ...state,
          revision: state.revision + 1,
          pendingWindow: null,
          updatedAt: input.updatedAt,
        });
        transaction.set(stateRef, nextState);
      }
      return { ok: true as const, definition: nextDefinition };
    });
  }

  async reserveRun(input: ReserveRunInput): Promise<
    | { ok: true; disposition: 'reserved' | 'existing'; run: MessageDigestRunDocument }
    | {
        ok: false;
        code:
          | 'NOT_FOUND'
          | 'NOT_ACTIVE'
          | 'REVISION_CONFLICT'
          | 'READINESS_CHANGED'
          | 'RUN_IN_PROGRESS'
          | 'RUN_CONFLICT';
      }
  > {
    const run = MessageDigestRunDocumentSchema.parse(input.run);
    const outbox = MessageDigestDispatchOutboxDocumentSchema.parse(input.outbox);
    if (
      run.userId !== input.userId ||
      run.definitionId !== input.definitionId ||
      outbox.userId !== input.userId ||
      outbox.definitionId !== input.definitionId ||
      outbox.runId !== run.runId ||
      run.definitionRevision !== input.expectedDefinitionRevision
    ) {
      return { ok: false, code: 'RUN_CONFLICT' };
    }
    const refs = this.refs(input.definitionId, run.runId, outbox.outboxId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const [definitionSnapshot, stateSnapshot, runSnapshot, outboxSnapshot] = await Promise.all([
        transaction.get(refs.definition),
        transaction.get(refs.state),
        transaction.get(refs.run),
        transaction.get(refs.outbox),
      ]);
      if (runSnapshot.exists) {
        const existing = parseRun(runSnapshot.data());
        if (
          existing.userId === input.userId &&
          existing.definitionId === input.definitionId &&
          existing.requestIdDigest === run.requestIdDigest &&
          outboxSnapshot.exists
        ) {
          parseOutbox(outboxSnapshot.data());
          return { ok: true as const, disposition: 'existing' as const, run: existing };
        }
        return { ok: false as const, code: 'RUN_CONFLICT' as const };
      }
      if (!definitionSnapshot.exists || !stateSnapshot.exists || outboxSnapshot.exists) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const state = parseState(stateSnapshot.data());
      if (definition.userId !== input.userId || state.userId !== input.userId) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      if (definition.status !== 'active') {
        return { ok: false as const, code: 'NOT_ACTIVE' as const };
      }
      if (state.pendingWindow !== null) {
        return { ok: false as const, code: 'RUN_IN_PROGRESS' as const };
      }
      if (
        definition.revision !== input.expectedDefinitionRevision ||
        state.revision !== input.expectedStateRevision ||
        definition.erasureEpoch !== input.expectedErasureEpoch
      ) {
        return { ok: false as const, code: 'REVISION_CONFLICT' as const };
      }
      if (
        definition.delivery.readinessObservationVersion !==
        input.expectedReadinessObservationVersion
      ) {
        return { ok: false as const, code: 'READINESS_CHANGED' as const };
      }
      if (
        run.windowStart !== state.checkpointAt ||
        run.windowEnd <= run.windowStart ||
        run.instructionRevision !== definition.instructions.revision
      ) {
        return { ok: false as const, code: 'RUN_CONFLICT' as const };
      }

      const pendingWindow = {
        runId: run.runId,
        trigger: run.trigger,
        requestIdDigest: run.requestIdDigest,
        windowStart: run.windowStart,
        windowEnd: run.windowEnd,
        definitionRevision: definition.revision,
        stateRevision: state.revision,
        erasureEpoch: definition.erasureEpoch,
        reservedAt: run.createdAt,
      };
      const nextState = MessageDigestStateDocumentSchema.parse({
        ...state,
        revision: state.revision + 1,
        pendingWindow,
        updatedAt: run.createdAt,
      });
      const nextDefinition = MessageDigestDefinitionDocumentSchema.parse({
        ...definition,
        hasRuns: true,
        latestRun: toLatestRunProjection(run),
        nextRunAt: input.nextRunAt,
        delivery: {
          type: 'whatsapp_primary',
          readinessObservationVersion: input.readinessObservation.observationVersion,
          readinessObservedAt: input.readinessObservation.observedAt,
        },
        updatedAt: run.createdAt,
      });
      transaction.set(refs.run, run);
      transaction.set(refs.outbox, outbox);
      transaction.set(refs.state, nextState);
      transaction.set(refs.definition, nextDefinition);
      return { ok: true as const, disposition: 'reserved' as const, run };
    });
  }

  async claimRunLease(input: {
    userId: string;
    runId: string;
    ownerDigest: string;
    now: string;
    expiresAt: string;
  }): Promise<
    | {
        ok: true;
        disposition: 'acquired' | 'existing';
        fence: number;
        run: MessageDigestRunDocument;
      }
    | { ok: false; code: 'NOT_FOUND' | 'LEASE_BUSY' | 'RUN_TERMINAL' | 'RESERVATION_LOST' }
  > {
    assertLeaseTimes(input.now, input.expiresAt);
    const ref = this.config.firestore.collection(MESSAGE_DIGEST_RUNS_COLLECTION).doc(input.runId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
      const run = parseRun(snapshot.data());
      if (run.userId !== input.userId) return { ok: false as const, code: 'NOT_FOUND' as const };
      const definitionRef = this.config.firestore
        .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
        .doc(run.definitionId);
      const stateRef = this.config.firestore
        .collection(MESSAGE_DIGEST_STATES_COLLECTION)
        .doc(run.definitionId);
      const [definitionSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(stateRef),
      ]);
      if (isTerminalRun(run)) return { ok: false as const, code: 'RUN_TERMINAL' as const };
      if (!definitionSnapshot.exists || !stateSnapshot.exists) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const state = parseState(stateSnapshot.data());
      if (
        !hasCurrentRunReservation(definition, state, run, input.userId)
      ) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      if (run.lease !== null && Date.parse(run.lease.expiresAt) > Date.parse(input.now)) {
        if (run.lease.ownerDigest !== input.ownerDigest) {
          return { ok: false as const, code: 'LEASE_BUSY' as const };
        }
        return {
          ok: true as const,
          disposition: 'existing' as const,
          fence: run.lease.fence,
          run,
        };
      }
      const fence = (run.lease?.fence ?? 0) + 1;
      const nextRun = MessageDigestRunDocumentSchema.parse({
        ...run,
        generationStatus: 'processing',
        processingStage: 'reading_messages',
        attempts: run.attempts + 1,
        lease: {
          ownerDigest: input.ownerDigest,
          fence,
          expiresAt: input.expiresAt,
          renewedAt: input.now,
        },
        updatedAt: input.now,
      });
      transaction.set(ref, nextRun);
      transaction.set(
        definitionRef,
        withLatestRunProjection(definition, nextRun, { allowInitialize: true })
      );
      return { ok: true as const, disposition: 'acquired' as const, fence, run: nextRun };
    });
  }

  async renewRunLease(input: {
    userId: string;
    runId: string;
    ownerDigest: string;
    fence: number;
    now: string;
    expiresAt: string;
  }): Promise<
    | { ok: true; expiresAt: string }
    | { ok: false; code: 'NOT_FOUND' | 'LEASE_LOST' | 'RUN_TERMINAL' | 'RESERVATION_LOST' }
  > {
    assertLeaseTimes(input.now, input.expiresAt);
    const ref = this.config.firestore.collection(MESSAGE_DIGEST_RUNS_COLLECTION).doc(input.runId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
      const run = parseRun(snapshot.data());
      if (run.userId !== input.userId) return { ok: false as const, code: 'NOT_FOUND' as const };
      const definitionRef = this.config.firestore
        .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
        .doc(run.definitionId);
      const stateRef = this.config.firestore
        .collection(MESSAGE_DIGEST_STATES_COLLECTION)
        .doc(run.definitionId);
      const [definitionSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(stateRef),
      ]);
      if (isTerminalRun(run)) return { ok: false as const, code: 'RUN_TERMINAL' as const };
      if (!definitionSnapshot.exists || !stateSnapshot.exists) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const state = parseState(stateSnapshot.data());
      if (
        !hasCurrentRunReservation(definition, state, run, input.userId)
      ) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      if (!ownsLease(run, input) || Date.parse(run.lease.expiresAt) <= Date.parse(input.now)) {
        return { ok: false as const, code: 'LEASE_LOST' as const };
      }
      const nextRun = MessageDigestRunDocumentSchema.parse({
        ...run,
        lease: { ...run.lease, expiresAt: input.expiresAt, renewedAt: input.now },
        updatedAt: input.now,
      });
      transaction.set(ref, nextRun);
      return { ok: true as const, expiresAt: input.expiresAt };
    });
  }

  async markRunProcessingStage(input: {
    userId: string;
    runId: string;
    ownerDigest: string;
    fence: number;
    now: string;
    processingStage: 'aggregating' | 'repairing';
  }): Promise<
    | { ok: true }
    | { ok: false; code: 'NOT_FOUND' | 'LEASE_LOST' | 'RUN_TERMINAL' | 'RESERVATION_LOST' }
  > {
    assertTimestamp(input.now);
    const runRef = this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .doc(input.runId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const runSnapshot = await transaction.get(runRef);
      if (!runSnapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
      const run = parseRun(runSnapshot.data());
      if (run.userId !== input.userId) return { ok: false as const, code: 'NOT_FOUND' as const };
      const definitionRef = this.config.firestore
        .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
        .doc(run.definitionId);
      const stateRef = this.config.firestore
        .collection(MESSAGE_DIGEST_STATES_COLLECTION)
        .doc(run.definitionId);
      const [definitionSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(stateRef),
      ]);
      if (isTerminalRun(run)) return { ok: false as const, code: 'RUN_TERMINAL' as const };
      if (!definitionSnapshot.exists || !stateSnapshot.exists) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const state = parseState(stateSnapshot.data());
      if (!hasCurrentRunReservation(definition, state, run, input.userId)) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      if (!ownsLease(run, input) || Date.parse(run.lease.expiresAt) <= Date.parse(input.now)) {
        return { ok: false as const, code: 'LEASE_LOST' as const };
      }
      const nextRun = MessageDigestRunDocumentSchema.parse({
        ...run,
        generationStatus: 'processing',
        processingStage: input.processingStage,
        updatedAt: input.now,
      });
      transaction.set(runRef, nextRun);
      transaction.set(
        definitionRef,
        withLatestRunProjection(definition, nextRun, { allowInitialize: true })
      );
      return { ok: true as const };
    });
  }

  async completeRun(input: {
    userId: string;
    runId: string;
    ownerDigest: string;
    fence: number;
    completedAt: string;
    generationStatus: 'completed' | 'skipped_no_activity';
    output: MessageDigestCompletionOutput;
    deliveryOutbox?: MessageDigestDispatchOutboxDocument | undefined;
  }): Promise<
    | { ok: true; disposition: 'completed' | 'existing'; run: MessageDigestRunDocument }
    | { ok: false; code: 'NOT_FOUND' | 'LEASE_LOST' | 'RESERVATION_LOST' }
  > {
    assertTimestamp(input.completedAt);
    const deliveryOutbox = validateCompletionOutbox(input);
    const runRef = this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .doc(input.runId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const runSnapshot = await transaction.get(runRef);
      if (!runSnapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
      const run = parseRun(runSnapshot.data());
      if (run.userId !== input.userId) return { ok: false as const, code: 'NOT_FOUND' as const };
      if (run.generationStatus === 'completed' || run.generationStatus === 'skipped_no_activity') {
        return { ok: true as const, disposition: 'existing' as const, run };
      }
      const definitionRef = this.config.firestore
        .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
        .doc(run.definitionId);
      const stateRef = this.config.firestore
        .collection(MESSAGE_DIGEST_STATES_COLLECTION)
        .doc(run.definitionId);
      const deliveryOutboxRef =
        deliveryOutbox === null
          ? null
          : this.config.firestore
              .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
              .doc(deliveryOutbox.outboxId);
      const [definitionSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(stateRef),
      ]);
      if (!definitionSnapshot.exists || !stateSnapshot.exists) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const state = parseState(stateSnapshot.data());
      const deliveryOutboxSnapshot =
        deliveryOutboxRef === null ? null : await transaction.get(deliveryOutboxRef);
      if (
        !hasCurrentRunReservation(definition, state, run, input.userId) ||
        (deliveryOutbox !== null && deliveryOutbox.definitionId !== run.definitionId)
      ) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      if (
        !ownsLease(run, input) ||
        Date.parse(run.lease.expiresAt) <= Date.parse(input.completedAt)
      ) {
        return { ok: false as const, code: 'LEASE_LOST' as const };
      }
      if (deliveryOutboxSnapshot?.exists === true) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      const processingStage =
        input.generationStatus === 'completed' ? 'completed' : 'skipped_no_activity';
      const completedRun = MessageDigestRunDocumentSchema.parse({
        ...run,
        generationStatus: input.generationStatus,
        processingStage,
        lease: null,
        ...input.output,
        delivery: {
          ...run.delivery,
          status: input.generationStatus === 'completed' ? 'pending' : 'not_sent',
          acceptedAt: null,
          failedAt: null,
          failureCode: null,
          reconciliationAttempts: 0,
          nextCheckAt: input.generationStatus === 'completed' ? input.completedAt : null,
          missingSince: null,
        },
        safeFailureCode: null,
        updatedAt: input.completedAt,
        completedAt: input.completedAt,
      });
      const runHash = digestJson({
        runId: completedRun.runId,
        windowStart: completedRun.windowStart,
        windowEnd: completedRun.windowEnd,
        headline: completedRun.headline,
        summaryMarkdown: completedRun.summaryMarkdown,
        evidenceMessageRefs: completedRun.evidenceMessageRefs,
      });
      const nextState = MessageDigestStateDocumentSchema.parse({
        ...state,
        revision: state.revision + 1,
        checkpointAt: run.windowEnd,
        continuityMemoryMarkdown: completedRun.continuityMemoryMarkdown ?? '',
        precedingRunId: run.runId,
        precedingRunHash: runHash,
        pendingWindow: null,
        updatedAt: input.completedAt,
      });
      const nextDefinition = MessageDigestDefinitionDocumentSchema.parse({
        ...definition,
        checkpointAt: run.windowEnd,
        lastRunAt: input.completedAt,
        latestRun: nextLatestRunProjection(definition, completedRun, true),
        updatedAt: input.completedAt,
      });
      transaction.set(runRef, completedRun);
      transaction.set(stateRef, nextState);
      transaction.set(definitionRef, nextDefinition);
      if (deliveryOutboxRef !== null && deliveryOutbox !== null) {
        transaction.set(deliveryOutboxRef, deliveryOutbox);
      }
      return { ok: true as const, disposition: 'completed' as const, run: completedRun };
    });
  }

  async failRun(input: {
    userId: string;
    runId: string;
    ownerDigest: string;
    fence: number;
    failedAt: string;
    safeFailureCode: string;
    pauseDefinition: boolean;
  }): Promise<
    { ok: true } | { ok: false; code: 'NOT_FOUND' | 'LEASE_LOST' | 'RESERVATION_LOST' }
  > {
    assertTimestamp(input.failedAt);
    const runRef = this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .doc(input.runId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(runRef);
      if (!snapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
      const run = parseRun(snapshot.data());
      if (run.userId !== input.userId) return { ok: false as const, code: 'NOT_FOUND' as const };
      const definitionRef = this.config.firestore
        .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
        .doc(run.definitionId);
      const stateRef = this.config.firestore
        .collection(MESSAGE_DIGEST_STATES_COLLECTION)
        .doc(run.definitionId);
      const [definitionSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(stateRef),
      ]);
      if (!definitionSnapshot.exists || !stateSnapshot.exists) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const state = parseState(stateSnapshot.data());
      if (!hasCurrentRunReservation(definition, state, run, input.userId)) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      if (!ownsLease(run, input)) {
        return { ok: false as const, code: 'LEASE_LOST' as const };
      }
      if (Date.parse(run.lease.expiresAt) <= Date.parse(input.failedAt)) {
        return { ok: false as const, code: 'LEASE_LOST' as const };
      }
      const failedRun = MessageDigestRunDocumentSchema.parse({
        ...run,
        generationStatus: 'failed',
        processingStage: 'failed',
        lease: null,
        safeFailureCode: input.safeFailureCode,
        updatedAt: input.failedAt,
        completedAt: input.failedAt,
      });
      transaction.set(runRef, failedRun);
      const definitionWithLatestRun = withLatestRunProjection(definition, failedRun, {
        allowInitialize: true,
      });
      const nextDefinition = input.pauseDefinition
        ? MessageDigestDefinitionDocumentSchema.parse({
            ...definitionWithLatestRun,
            status: 'paused',
            listStatus: 'needs_attention',
            attentionCode: input.safeFailureCode,
            revision: definition.revision + 1,
            updatedAt: input.failedAt,
          })
        : definitionWithLatestRun;
      transaction.set(definitionRef, nextDefinition);
      return { ok: true as const };
    });
  }

  async getOwnedDispatch(input: {
    userId: string;
    definitionId: string;
    runId: string;
    outboxId: string;
  }): Promise<MessageDigestDispatchOutboxDocument | null> {
    const snapshot = await this.config.firestore
      .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
      .doc(input.outboxId)
      .get();
    if (!snapshot.exists) return null;
    const dispatch = parseOutbox(snapshot.data());
    return dispatch.userId === input.userId &&
      dispatch.definitionId === input.definitionId &&
      dispatch.runId === input.runId
      ? dispatch
      : null;
  }

  async retryFailedGeneration(input: {
    userId: string;
    definitionId: string;
    runId: string;
    retriedAt: string;
    outbox: MessageDigestDispatchOutboxDocument;
  }): Promise<
    | {
        ok: true;
        disposition: 'retried' | 'existing';
        run: MessageDigestRunDocument;
      }
    | {
        ok: false;
        code: 'NOT_FOUND' | 'RESERVATION_LOST' | 'RUN_IN_PROGRESS' | 'RETRY_CONFLICT';
      }
  > {
    assertTimestamp(input.retriedAt);
    const outbox = MessageDigestDispatchOutboxDocumentSchema.parse(input.outbox);
    if (!retryOutboxMatchesInput(outbox, input, 'run_request')) {
      return { ok: false, code: 'RETRY_CONFLICT' };
    }
    const definitionRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(input.definitionId);
    const stateRef = this.config.firestore
      .collection(MESSAGE_DIGEST_STATES_COLLECTION)
      .doc(input.definitionId);
    const runRef = this.config.firestore.collection(MESSAGE_DIGEST_RUNS_COLLECTION).doc(input.runId);
    const outboxRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
      .doc(outbox.outboxId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const [definitionSnapshot, stateSnapshot, runSnapshot, outboxSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(stateRef),
        transaction.get(runRef),
        transaction.get(outboxRef),
      ]);
      if (!definitionSnapshot.exists || !stateSnapshot.exists || !runSnapshot.exists) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const state = parseState(stateSnapshot.data());
      const run = parseRun(runSnapshot.data());
      if (
        definition.userId !== input.userId ||
        state.userId !== input.userId ||
        run.userId !== input.userId ||
        run.definitionId !== input.definitionId
      ) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      if (outboxSnapshot.exists) {
        const existingOutbox = parseOutbox(outboxSnapshot.data());
        return sameFrozenDispatch(existingOutbox, outbox)
          ? { ok: true as const, disposition: 'existing' as const, run }
          : { ok: false as const, code: 'RETRY_CONFLICT' as const };
      }
      if (!hasCurrentRunReservation(definition, state, run, input.userId)) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      if (run.generationStatus !== 'failed') {
        return { ok: false as const, code: 'RUN_IN_PROGRESS' as const };
      }
      const retriedRun = MessageDigestRunDocumentSchema.parse({
        ...run,
        generationStatus: 'queued',
        processingStage: 'queued',
        lease: null,
        headline: null,
        summaryMarkdown: null,
        evidenceMessageRefs: [],
        continuityMemoryMarkdown: null,
        effectiveMessageCount: null,
        promptVersion: null,
        model: null,
        usage: null,
        delivery: {
          ...run.delivery,
          status: 'not_sent',
          acceptedAt: null,
          failedAt: null,
          failureCode: null,
          reconciliationAttempts: 0,
          nextCheckAt: null,
          missingSince: null,
        },
        safeFailureCode: null,
        updatedAt: input.retriedAt,
        completedAt: null,
      });
      transaction.set(runRef, retriedRun);
      transaction.set(
        definitionRef,
        withLatestRunProjection(definition, retriedRun, { allowInitialize: true })
      );
      transaction.set(outboxRef, outbox);
      return { ok: true as const, disposition: 'retried' as const, run: retriedRun };
    });
  }

  async retryFailedDelivery(input: {
    userId: string;
    definitionId: string;
    runId: string;
    retriedAt: string;
    originalOutboxId: string;
    outbox: MessageDigestDispatchOutboxDocument;
  }): Promise<
    | {
        ok: true;
        disposition: 'retried' | 'existing';
        run: MessageDigestRunDocument;
      }
    | {
        ok: false;
        code: 'NOT_FOUND' | 'RESERVATION_LOST' | 'RUN_IN_PROGRESS' | 'RETRY_CONFLICT';
      }
  > {
    assertTimestamp(input.retriedAt);
    const outbox = MessageDigestDispatchOutboxDocumentSchema.parse(input.outbox);
    if (!retryOutboxMatchesInput(outbox, input, 'whatsapp_delivery')) {
      return { ok: false, code: 'RETRY_CONFLICT' };
    }
    const definitionRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(input.definitionId);
    const runRef = this.config.firestore.collection(MESSAGE_DIGEST_RUNS_COLLECTION).doc(input.runId);
    const originalOutboxRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
      .doc(input.originalOutboxId);
    const retryOutboxRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
      .doc(outbox.outboxId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const [definitionSnapshot, runSnapshot, originalSnapshot, retrySnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(runRef),
        transaction.get(originalOutboxRef),
        transaction.get(retryOutboxRef),
      ]);
      if (!definitionSnapshot.exists || !runSnapshot.exists || !originalSnapshot.exists) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const run = parseRun(runSnapshot.data());
      const original = parseOutbox(originalSnapshot.data());
      if (
        definition.userId !== input.userId ||
        run.userId !== input.userId ||
        run.definitionId !== input.definitionId ||
        original.userId !== input.userId ||
        original.definitionId !== input.definitionId ||
        original.runId !== input.runId
      ) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      if (retrySnapshot.exists) {
        const existingOutbox = parseOutbox(retrySnapshot.data());
        return sameFrozenDispatch(existingOutbox, outbox)
          ? { ok: true as const, disposition: 'existing' as const, run }
          : { ok: false as const, code: 'RETRY_CONFLICT' as const };
      }
      if (definition.status !== 'active' && definition.status !== 'paused') {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      if (run.generationStatus !== 'completed' || run.delivery.status !== 'failed') {
        return { ok: false as const, code: 'RUN_IN_PROGRESS' as const };
      }
      if (
        original.kind !== 'whatsapp_delivery' ||
        outbox.payloadJson !== original.payloadJson ||
        outbox.payloadDigest !== original.payloadDigest
      ) {
        return { ok: false as const, code: 'RETRY_CONFLICT' as const };
      }
      const retriedRun = MessageDigestRunDocumentSchema.parse({
        ...run,
        delivery: {
          ...run.delivery,
          status: 'pending',
          acceptedAt: null,
          failedAt: null,
          failureCode: null,
          reconciliationAttempts: 0,
          nextCheckAt: input.retriedAt,
          missingSince: null,
        },
        updatedAt: input.retriedAt,
      });
      transaction.set(runRef, retriedRun);
      transaction.set(
        definitionRef,
        withLatestRunProjection(definition, retriedRun, { allowInitialize: true })
      );
      transaction.set(retryOutboxRef, outbox);
      return { ok: true as const, disposition: 'retried' as const, run: retriedRun };
    });
  }

  async recordRunDeliveryState(input: {
    userId: string;
    definitionId: string;
    runId: string;
    expectedErasureEpoch: number;
    observedAt: string;
    delivery:
      | { status: 'sent'; acceptedAt: string }
      | { status: 'ambiguous'; acceptedAt?: string | undefined }
      | { status: 'failed'; failedAt: string; failureCode: string };
  }): Promise<
    | {
        ok: true;
        disposition: 'updated' | 'existing';
        run: MessageDigestRunDocument;
      }
    | { ok: false; code: 'NOT_FOUND' | 'RESERVATION_LOST' | 'DELIVERY_CONFLICT' }
  > {
    assertTimestamp(input.observedAt);
    if (!Number.isInteger(input.expectedErasureEpoch) || input.expectedErasureEpoch < 0) {
      throw new Error('INVALID_ERASURE_EPOCH');
    }
    if (input.delivery.status === 'sent') assertTimestamp(input.delivery.acceptedAt);
    if (input.delivery.status === 'ambiguous' && input.delivery.acceptedAt !== undefined) {
      assertTimestamp(input.delivery.acceptedAt);
    }
    if (input.delivery.status === 'failed') assertTimestamp(input.delivery.failedAt);

    const definitionRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(input.definitionId);
    const runRef = this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .doc(input.runId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const [definitionSnapshot, runSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(runRef),
      ]);
      if (!definitionSnapshot.exists || !runSnapshot.exists) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const run = parseRun(runSnapshot.data());
      if (
        definition.userId !== input.userId ||
        run.userId !== input.userId ||
        run.definitionId !== input.definitionId
      ) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      if (
        (definition.status !== 'active' && definition.status !== 'paused') ||
        definition.erasureEpoch !== input.expectedErasureEpoch
      ) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      if (run.generationStatus !== 'completed') {
        return { ok: false as const, code: 'DELIVERY_CONFLICT' as const };
      }
      if (run.delivery.status !== 'pending') {
        return deliveryObservationMatches(run, input.delivery)
          ? { ok: true as const, disposition: 'existing' as const, run }
          : { ok: false as const, code: 'DELIVERY_CONFLICT' as const };
      }

      const delivery =
        input.delivery.status === 'sent'
          ? {
              ...run.delivery,
              status: 'sent' as const,
              acceptedAt: input.delivery.acceptedAt,
              failedAt: null,
              failureCode: null,
              reconciliationAttempts: run.delivery.reconciliationAttempts + 1,
              nextCheckAt: null,
              missingSince: null,
            }
          : input.delivery.status === 'ambiguous'
            ? {
                ...run.delivery,
                status: 'ambiguous' as const,
                acceptedAt: input.delivery.acceptedAt ?? null,
                failedAt: null,
                failureCode: null,
                reconciliationAttempts: run.delivery.reconciliationAttempts + 1,
                nextCheckAt: null,
                missingSince: null,
              }
            : {
                ...run.delivery,
                status: 'failed' as const,
                acceptedAt: null,
                failedAt: input.delivery.failedAt,
                failureCode: input.delivery.failureCode,
                reconciliationAttempts: run.delivery.reconciliationAttempts + 1,
                nextCheckAt: null,
                missingSince: null,
              };
      const updatedRun = MessageDigestRunDocumentSchema.parse({
        ...run,
        delivery,
        updatedAt: input.observedAt,
      });
      transaction.set(runRef, updatedRun);
      transaction.set(definitionRef, withLatestRunProjection(definition, updatedRun));
      return { ok: true as const, disposition: 'updated' as const, run: updatedRun };
    });
  }

  async recordRunDeliveryObservation(input: {
    userId: string;
    definitionId: string;
    runId: string;
    expectedErasureEpoch: number;
    expectedReconciliationAttempts: number;
    observedAt: string;
    nextCheckAt: string;
    observation: 'pending' | 'missing' | 'unavailable';
  }): Promise<
    | { ok: true; disposition: 'updated' | 'existing'; run: MessageDigestRunDocument }
    | { ok: false; code: 'NOT_FOUND' | 'RESERVATION_LOST' | 'DELIVERY_CONFLICT' }
  > {
    assertTimestamp(input.observedAt);
    assertTimestamp(input.nextCheckAt);
    if (Date.parse(input.nextCheckAt) <= Date.parse(input.observedAt)) {
      throw new Error('INVALID_NEXT_CHECK');
    }
    if (
      !Number.isInteger(input.expectedErasureEpoch) ||
      input.expectedErasureEpoch < 0 ||
      !Number.isInteger(input.expectedReconciliationAttempts) ||
      input.expectedReconciliationAttempts < 0
    ) {
      throw new Error('INVALID_DELIVERY_OBSERVATION');
    }

    const definitionRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(input.definitionId);
    const runRef = this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .doc(input.runId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const [definitionSnapshot, runSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(runRef),
      ]);
      if (!definitionSnapshot.exists || !runSnapshot.exists) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const run = parseRun(runSnapshot.data());
      if (
        definition.userId !== input.userId ||
        run.userId !== input.userId ||
        run.definitionId !== input.definitionId
      ) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      if (
        (definition.status !== 'active' && definition.status !== 'paused') ||
        definition.erasureEpoch !== input.expectedErasureEpoch
      ) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      if (
        run.generationStatus !== 'completed' ||
        run.delivery.status !== 'pending' ||
        run.delivery.reconciliationAttempts !== input.expectedReconciliationAttempts
      ) {
        return { ok: false as const, code: 'DELIVERY_CONFLICT' as const };
      }

      const updatedRun = MessageDigestRunDocumentSchema.parse({
        ...run,
        delivery: {
          ...run.delivery,
          reconciliationAttempts: run.delivery.reconciliationAttempts + 1,
          nextCheckAt: input.nextCheckAt,
          missingSince:
            input.observation === 'missing'
              ? (run.delivery.missingSince ?? input.observedAt)
              : input.observation === 'pending'
                ? null
                : run.delivery.missingSince,
        },
        updatedAt: input.observedAt,
      });
      transaction.set(runRef, updatedRun);
      return { ok: true as const, disposition: 'updated' as const, run: updatedRun };
    });
  }

  async getOwnedRun(input: {
    userId: string;
    definitionId: string;
    runId: string;
  }): Promise<MessageDigestRunDocument | null> {
    const snapshot = await this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .doc(input.runId)
      .get();
    if (!snapshot.exists) return null;
    const run = parseRun(snapshot.data());
    return isVisibleOwnedRun(run, input.userId, input.definitionId) ? run : null;
  }

  async listOwnedRuns(input: {
    userId: string;
    definitionId: string;
    limit: number;
    cursor?: string | undefined;
    windowStartFrom?: string | undefined;
    windowStartBefore?: string | undefined;
    generationStatus?: MessageDigestRunDocument['generationStatus'] | undefined;
    deliveryStatus?: MessageDigestRunDocument['delivery']['status'] | undefined;
    direction?: 'asc' | 'desc' | undefined;
    queryFingerprint: string;
  }): Promise<{ items: MessageDigestRunDocument[]; nextCursor: string | null }> {
    assertLimit(input.limit);
    if (input.windowStartFrom !== undefined) assertTimestamp(input.windowStartFrom);
    if (input.windowStartBefore !== undefined) assertTimestamp(input.windowStartBefore);
    const direction = input.direction ?? 'desc';
    let query = this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .where('userId', '==', input.userId)
      .where('definitionId', '==', input.definitionId)
      .where('recordRole', '==', 'canonical')
      .where('visibilityMigrationId', '==', null);
    if (input.windowStartFrom !== undefined) {
      query = query.where('windowStart', '>=', input.windowStartFrom);
    }
    if (input.windowStartBefore !== undefined) {
      query = query.where('windowStart', '<', input.windowStartBefore);
    }
    if (input.generationStatus !== undefined) {
      query = query.where('generationStatus', '==', input.generationStatus);
    }
    if (input.deliveryStatus !== undefined) {
      query = query.where('delivery.status', '==', input.deliveryStatus);
    }
    query = query
      .orderBy('windowStart', direction)
      .orderBy(FieldPath.documentId(), direction);
    if (input.cursor !== undefined) {
      const cursor = this.config.cursorCodec.read(input.cursor, {
        kind: 'runs',
        queryFingerprint: input.queryFingerprint,
      });
      if (!cursor.ok || cursor.value.length !== 2) throw new Error('INVALID_CURSOR');
      query = query.startAfter(...cursor.value);
    }
    const snapshot = await query.limit(input.limit + 1).get();
    const parsed = snapshot.docs.map((document) => parseRun(document.data()));
    const items = parsed.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        parsed.length > input.limit && last !== undefined
          ? this.config.cursorCodec.issue({
              kind: 'runs',
              queryFingerprint: input.queryFingerprint,
              values: [last.windowStart, last.runId],
            })
          : null,
    };
  }

  async listOwnedLegacyRuns(input: {
    userId: string;
    definitionId: string;
    activeMigrationId: string;
    legacyGroupKey: string;
    limit: number;
    cursor?: string | undefined;
    scheduledBoundaryFrom?: string | undefined;
    scheduledBoundaryBefore?: string | undefined;
    queryFingerprint: string;
  }): Promise<{ items: MessageDigestRunDocument[]; nextCursor: string | null }> {
    assertLimit(input.limit);
    if (input.scheduledBoundaryFrom !== undefined) {
      assertTimestamp(input.scheduledBoundaryFrom);
    }
    if (input.scheduledBoundaryBefore !== undefined) {
      assertTimestamp(input.scheduledBoundaryBefore);
    }
    if (!/^mdm_[A-Za-z0-9_-]{3,160}$/u.test(input.activeMigrationId)) {
      throw new Error('INVALID_MIGRATION_ID');
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.legacyGroupKey)) {
      throw new Error('INVALID_LEGACY_ALIAS');
    }
    let query = this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .where('userId', '==', input.userId)
      .where('definitionId', '==', input.definitionId)
      .where('recordRole', '==', 'canonical')
      .where('visibilityMigrationId', '==', null)
      .where('trigger', '==', 'scheduled')
      .where('generationStatus', '==', 'completed');
    if (input.scheduledBoundaryFrom !== undefined) {
      query = query.where('scheduledBoundary', '>=', input.scheduledBoundaryFrom);
    }
    if (input.scheduledBoundaryBefore !== undefined) {
      query = query.where('scheduledBoundary', '<', input.scheduledBoundaryBefore);
    }
    query = query
      .orderBy('scheduledBoundary', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (input.cursor !== undefined) {
      const cursor = this.config.cursorCodec.read(input.cursor, {
        kind: 'legacy_runs',
        queryFingerprint: input.queryFingerprint,
      });
      if (!cursor.ok || cursor.value.length !== 2) throw new Error('INVALID_CURSOR');
      query = query.startAfter(...cursor.value);
    }

    const definitionRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(input.definitionId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const definitionSnapshot = await transaction.get(definitionRef);
      if (!definitionSnapshot.exists) return { items: [], nextCursor: null };
      const definition = parseDefinition(definitionSnapshot.data());
      if (
        definition.userId !== input.userId ||
        (definition.status !== 'active' && definition.status !== 'paused') ||
        definition.activeMigrationId !== input.activeMigrationId ||
        definition.legacyAlias?.groupKey !== input.legacyGroupKey ||
        definition.source.chatType !== 'group'
      ) {
        return { items: [], nextCursor: null };
      }
      const snapshot = await transaction.get(query.limit(input.limit + 1));
      const parsed = snapshot.docs.map((document) => parseRun(document.data()));
      const items = parsed.slice(0, input.limit);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          parsed.length > input.limit && last !== undefined
            ? this.config.cursorCodec.issue({
                kind: 'legacy_runs',
                queryFingerprint: input.queryFingerprint,
                values: [last.scheduledBoundary, last.runId],
              })
            : null,
      };
    });
  }

  async claimDispatch(input: {
    outboxId: string;
    ownerDigest: string;
    now: string;
    expiresAt: string;
  }): Promise<
    | {
        ok: true;
        disposition: 'claimed' | 'existing';
        fence: number;
        dispatch: MessageDigestDispatchOutboxDocument;
      }
    | {
        ok: false;
        code: 'NOT_FOUND' | 'NOT_READY' | 'CLAIM_BUSY' | 'TERMINAL' | 'RESERVATION_LOST';
      }
  > {
    assertLeaseTimes(input.now, input.expiresAt);
    const ref = this.config.firestore
      .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
      .doc(input.outboxId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
      const dispatch = parseOutbox(snapshot.data());
      if (dispatch.status !== 'pending') return { ok: false as const, code: 'TERMINAL' as const };
      const definitionRef = this.config.firestore
        .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
        .doc(dispatch.definitionId);
      const definitionSnapshot = await transaction.get(definitionRef);
      if (!definitionSnapshot.exists) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      if (
        definition.userId !== dispatch.userId ||
        (definition.status !== 'active' && definition.status !== 'paused')
      ) {
        return { ok: false as const, code: 'RESERVATION_LOST' as const };
      }
      if (Date.parse(dispatch.nextAttemptAt) > Date.parse(input.now)) {
        return { ok: false as const, code: 'NOT_READY' as const };
      }
      if (dispatch.claim !== null && Date.parse(dispatch.claim.expiresAt) > Date.parse(input.now)) {
        if (dispatch.claim.ownerDigest !== input.ownerDigest) {
          return { ok: false as const, code: 'CLAIM_BUSY' as const };
        }
        return {
          ok: true as const,
          disposition: 'existing' as const,
          fence: dispatch.claim.fence,
          dispatch,
        };
      }
      const fence = (dispatch.claim?.fence ?? 0) + 1;
      const claimed = MessageDigestDispatchOutboxDocumentSchema.parse({
        ...dispatch,
        attempts: dispatch.attempts + 1,
        claim: { ownerDigest: input.ownerDigest, fence, expiresAt: input.expiresAt },
        updatedAt: input.now,
      });
      transaction.set(ref, claimed);
      return {
        ok: true as const,
        disposition: 'claimed' as const,
        fence,
        dispatch: claimed,
      };
    });
  }

  async renewDispatchClaim(input: {
    outboxId: string;
    ownerDigest: string;
    fence: number;
    now: string;
    expiresAt: string;
  }): Promise<
    | { ok: true; expiresAt: string }
    | { ok: false; code: 'NOT_FOUND' | 'CLAIM_LOST' }
  > {
    assertLeaseTimes(input.now, input.expiresAt);
    const ref = this.config.firestore
      .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
      .doc(input.outboxId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
      const dispatch = parseOutbox(snapshot.data());
      if (
        dispatch.status !== 'pending' ||
        dispatch.claim?.ownerDigest !== input.ownerDigest ||
        dispatch.claim.fence !== input.fence ||
        Date.parse(dispatch.claim.expiresAt) <= Date.parse(input.now)
      ) {
        return { ok: false as const, code: 'CLAIM_LOST' as const };
      }
      const renewed = MessageDigestDispatchOutboxDocumentSchema.parse({
        ...dispatch,
        claim: { ...dispatch.claim, expiresAt: input.expiresAt },
        updatedAt: input.now,
      });
      transaction.set(ref, renewed);
      return { ok: true as const, expiresAt: input.expiresAt };
    });
  }

  async recordDispatchResult(input: {
    outboxId: string;
    ownerDigest: string;
    fence: number;
    now: string;
    outcome:
      | { status: 'published'; publishedAt: string }
      | { status: 'retry'; nextAttemptAt: string }
      | { status: 'terminal'; terminalCode: string };
  }): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'CLAIM_LOST' }> {
    assertTimestamp(input.now);
    const ref = this.config.firestore
      .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
      .doc(input.outboxId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
      const dispatch = parseOutbox(snapshot.data());
      if (
        dispatch.claim?.ownerDigest !== input.ownerDigest ||
        dispatch.claim.fence !== input.fence ||
        Date.parse(dispatch.claim.expiresAt) <= Date.parse(input.now)
      ) {
        return { ok: false as const, code: 'CLAIM_LOST' as const };
      }
      const definitionSnapshot = await transaction.get(
        this.config.firestore
          .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
          .doc(dispatch.definitionId)
      );
      if (!definitionSnapshot.exists) {
        return { ok: false as const, code: 'CLAIM_LOST' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const effectiveOutcome =
        definition.status !== 'active' &&
        definition.status !== 'paused' &&
        input.outcome.status === 'retry'
          ? ({ status: 'terminal', terminalCode: 'ERASURE_STARTED' } as const)
          : input.outcome;
      const outcomeUpdate =
        effectiveOutcome.status === 'published'
          ? {
              status: 'published' as const,
              claim: null,
              publishedAt: effectiveOutcome.publishedAt,
              terminalCode: null,
            }
          : effectiveOutcome.status === 'terminal'
            ? {
                status: 'terminal' as const,
                claim: null,
                publishedAt: null,
                terminalCode: effectiveOutcome.terminalCode,
              }
            : {
                status: 'pending' as const,
                claim: null,
                publishedAt: null,
                terminalCode: null,
                nextAttemptAt: effectiveOutcome.nextAttemptAt,
              };
      const updated = MessageDigestDispatchOutboxDocumentSchema.parse({
        ...dispatch,
        ...outcomeUpdate,
        updatedAt: input.now,
      });
      transaction.set(ref, updated);
      return { ok: true as const };
    });
  }

  async claimDeliveryAuthorization(input: {
    userId: string;
    definitionId: string;
    runId: string;
    idempotencyKey: string;
    payloadDigest: string;
    ownerDigest: string;
    now: string;
    expiresAt: string;
  }): Promise<
    | {
        ok: true;
        disposition: 'acquired' | 'existing';
        fence: number;
        expiresAt: string;
      }
    | { ok: false; code: 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'LEASE_BUSY' }
  > {
    assertLeaseTimes(input.now, input.expiresAt);
    const definitionRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(input.definitionId);
    const runRef = this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .doc(input.runId);
    const originalOutboxId = getMessageDigestDeliveryOutboxId(input.runId);
    const outboxRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
      .doc(originalOutboxId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const [definitionSnapshot, runSnapshot, outboxSnapshot] = await Promise.all([
        transaction.get(definitionRef),
        transaction.get(runRef),
        transaction.get(outboxRef),
      ]);
      if (!definitionSnapshot.exists || !runSnapshot.exists) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      if (!outboxSnapshot.exists) {
        return { ok: false as const, code: 'NOT_AUTHORIZED' as const };
      }
      const definition = parseDefinition(definitionSnapshot.data());
      const run = parseRun(runSnapshot.data());
      const outbox = parseOutbox(outboxSnapshot.data());
      if (
        definition.userId !== input.userId ||
        run.userId !== input.userId ||
        run.definitionId !== input.definitionId ||
        run.delivery.idempotencyKey !== input.idempotencyKey
      ) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      if (
        !/^[0-9a-f]{64}$/u.test(input.payloadDigest) ||
        outbox.outboxId !== originalOutboxId ||
        outbox.userId !== input.userId ||
        outbox.definitionId !== input.definitionId ||
        outbox.runId !== input.runId ||
        outbox.kind !== 'whatsapp_delivery' ||
        outbox.payloadDigest !== input.payloadDigest
      ) {
        return { ok: false as const, code: 'NOT_AUTHORIZED' as const };
      }
      if (
        (definition.status !== 'active' && definition.status !== 'paused') ||
        run.recordRole !== 'canonical' ||
        run.generationStatus !== 'completed' ||
        run.processingStage !== 'completed' ||
        run.delivery.status !== 'pending'
      ) {
        return { ok: false as const, code: 'NOT_AUTHORIZED' as const };
      }
      const current = run.deliveryAuthorization;
      if (
        current !== null &&
        current.releasedAt === null &&
        Date.parse(current.expiresAt) > Date.parse(input.now)
      ) {
        if (current.ownerDigest !== input.ownerDigest) {
          return { ok: false as const, code: 'LEASE_BUSY' as const };
        }
        const renewedAuthorization = {
          ...current,
          expiresAt: input.expiresAt,
          renewedAt: input.now,
        };
        const renewed = MessageDigestRunDocumentSchema.parse({
          ...run,
          deliveryAuthorization: renewedAuthorization,
          updatedAt: input.now,
        });
        transaction.set(runRef, renewed);
        return {
          ok: true as const,
          disposition: 'existing' as const,
          fence: current.fence,
          expiresAt: renewedAuthorization.expiresAt,
        };
      }
      const authorization = {
        ownerDigest: input.ownerDigest,
        fence: (current?.fence ?? 0) + 1,
        expiresAt: input.expiresAt,
        renewedAt: input.now,
        releasedAt: null,
      };
      const updated = MessageDigestRunDocumentSchema.parse({
        ...run,
        deliveryAuthorization: authorization,
        updatedAt: input.now,
      });
      transaction.set(runRef, updated);
      return {
        ok: true as const,
        disposition: 'acquired' as const,
        fence: authorization.fence,
        expiresAt: authorization.expiresAt,
      };
    });
  }

  async releaseDeliveryAuthorization(input: {
    userId: string;
    definitionId: string;
    runId: string;
    payloadDigest: string;
    ownerDigest: string;
    fence: number;
    now: string;
  }): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'LEASE_LOST' }> {
    assertTimestamp(input.now);
    const runRef = this.config.firestore
      .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
      .doc(input.runId);
    const originalOutboxId = getMessageDigestDeliveryOutboxId(input.runId);
    const outboxRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
      .doc(originalOutboxId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const [runSnapshot, outboxSnapshot] = await Promise.all([
        transaction.get(runRef),
        transaction.get(outboxRef),
      ]);
      if (!runSnapshot.exists || !outboxSnapshot.exists) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      const run = parseRun(runSnapshot.data());
      const outbox = parseOutbox(outboxSnapshot.data());
      if (run.userId !== input.userId || run.definitionId !== input.definitionId) {
        return { ok: false as const, code: 'NOT_FOUND' as const };
      }
      if (
        !/^[0-9a-f]{64}$/u.test(input.payloadDigest) ||
        run.delivery.idempotencyKey !== `message-digest:${input.runId}` ||
        outbox.outboxId !== originalOutboxId ||
        outbox.userId !== input.userId ||
        outbox.definitionId !== input.definitionId ||
        outbox.runId !== input.runId ||
        outbox.kind !== 'whatsapp_delivery' ||
        outbox.payloadDigest !== input.payloadDigest
      ) {
        return { ok: false as const, code: 'LEASE_LOST' as const };
      }
      const current = run.deliveryAuthorization;
      if (
        current?.ownerDigest !== input.ownerDigest ||
        current.fence !== input.fence
      ) {
        return { ok: false as const, code: 'LEASE_LOST' as const };
      }
      if (current.releasedAt !== null) return { ok: true as const };
      if (Date.parse(current.expiresAt) <= Date.parse(input.now)) {
        return { ok: false as const, code: 'LEASE_LOST' as const };
      }
      const updated = MessageDigestRunDocumentSchema.parse({
        ...run,
        deliveryAuthorization: {
          ...current,
          expiresAt: input.now,
          releasedAt: input.now,
        },
        updatedAt: input.now,
      });
      transaction.set(runRef, updated);
      return { ok: true as const };
    });
  }

  async getOwnedErasureRequest(
    userId: string,
    erasureRequestId: string
  ): Promise<MessageDigestErasureRequestDocument | null> {
    const snapshot = await this.config.firestore
      .collection(MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION)
      .doc(erasureRequestId)
      .get();
    if (!snapshot.exists) return null;
    const request = parseErasure(snapshot.data());
    return request.userId === userId ? request : null;
  }

  async startOrResumeDefinitionErasure(input: {
    userId: string;
    definitionId: string;
    erasureRequestId: string;
    requestIdDigest: string;
    now: string;
    limit: number;
  }): Promise<
    | {
        ok: true;
        status: 'in_progress' | 'completed';
        deletedThisCall: number;
        request: MessageDigestErasureRequestDocument;
      }
    | { ok: false; code: 'NOT_FOUND' | 'ERASURE_CONFLICT' }
  > {
    assertTimestamp(input.now);
    assertLimit(input.limit);
    const definitionRef = this.config.firestore
      .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
      .doc(input.definitionId);
    const requestRef = this.config.firestore
      .collection(MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION)
      .doc(input.erasureRequestId);
    return await this.config.firestore.runTransaction(async (transaction) => {
      const [requestSnapshot, definitionSnapshot] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(definitionRef),
      ]);
      let request: MessageDigestErasureRequestDocument;
      let definition: MessageDigestDefinitionDocument | null = null;
      if (requestSnapshot.exists) {
        request = parseErasure(requestSnapshot.data());
        if (
          request.userId !== input.userId ||
          request.definitionId !== input.definitionId ||
          request.requestIdDigest !== input.requestIdDigest
        ) {
          return { ok: false as const, code: 'ERASURE_CONFLICT' as const };
        }
        if (request.stage === 'completed') {
          return {
            ok: true as const,
            status: 'completed' as const,
            deletedThisCall: 0,
            request,
          };
        }
      } else {
        if (!definitionSnapshot.exists) return { ok: false as const, code: 'NOT_FOUND' as const };
        definition = parseDefinition(definitionSnapshot.data());
        if (definition.userId !== input.userId) {
          return { ok: false as const, code: 'NOT_FOUND' as const };
        }
        if (
          definition.status === 'deleting' ||
          definition.activeErasureRequestId !== null
        ) {
          return { ok: false as const, code: 'ERASURE_CONFLICT' as const };
        }
        request = MessageDigestErasureRequestDocumentSchema.parse({
          version: 1,
          erasureRequestId: input.erasureRequestId,
          requestIdDigest: input.requestIdDigest,
          userId: input.userId,
          definitionId: input.definitionId,
          erasureEpoch: definition.erasureEpoch + 1,
          stage: 'quiescing',
          cursor: null,
          deletedCounts: { runs: 0, outbox: 0, state: 0, definition: 0, legacy: 0 },
          createdAt: input.now,
          updatedAt: input.now,
          completedAt: null,
          expiresAt: null,
        });
      }

      const deletion = await this.readErasureBatch(transaction, request, input.limit, input.now);
      const nextCounts =
        deletion.countKey === null
          ? request.deletedCounts
          : {
              ...request.deletedCounts,
              [deletion.countKey]:
                request.deletedCounts[deletion.countKey] + deletion.documents.length,
            };
      const nextStage = deletion.documents.length === 0 ? deletion.nextStage : request.stage;
      const completed = nextStage === 'completed';
      const nextRequest = MessageDigestErasureRequestDocumentSchema.parse({
        ...request,
        stage: nextStage,
        cursor: null,
        deletedCounts: nextCounts,
        updatedAt: input.now,
        completedAt: completed ? input.now : null,
        expiresAt: completed
          ? Math.floor((Date.parse(input.now) + 30 * 24 * 60 * 60 * 1000) / 1000)
          : null,
      });

      if (definition !== null) {
        const deletingDefinition = MessageDigestDefinitionDocumentSchema.parse({
          ...definition,
          status: 'deleting',
          listStatus: 'paused',
          attentionCode: null,
          erasureEpoch: nextRequest.erasureEpoch,
          activeErasureRequestId: input.erasureRequestId,
          updatedAt: input.now,
        });
        transaction.set(definitionRef, deletingDefinition);
      }
      for (const document of [...deletion.documents, ...deletion.cleanupDocuments]) {
        transaction.delete(document.ref);
      }
      transaction.set(requestRef, nextRequest);
      return {
        ok: true as const,
        status: completed ? ('completed' as const) : ('in_progress' as const),
        deletedThisCall: deletion.documents.length,
        request: nextRequest,
      };
    });
  }

  private async readErasureBatch(
    transaction: Parameters<Parameters<Firestore['runTransaction']>[0]>[0],
    request: MessageDigestErasureRequestDocument,
    limit: number,
    now: string
  ): Promise<{
    documents: { ref: FirebaseFirestore.DocumentReference }[];
    cleanupDocuments: { ref: FirebaseFirestore.DocumentReference }[];
    countKey: keyof MessageDigestErasureRequestDocument['deletedCounts'] | null;
    nextStage: MessageDigestErasureRequestDocument['stage'];
  }> {
    if (request.stage === 'quiescing') {
      const [activeRunLeases, activeDispatchClaims, activeDeliveryAuthorizations] =
        await Promise.all([
        transaction.get(
          this.config.firestore
            .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
            .where('userId', '==', request.userId)
            .where('definitionId', '==', request.definitionId)
            .where('lease.expiresAt', '>', now)
            .orderBy('lease.expiresAt', 'asc')
            .limit(1)
        ),
        transaction.get(
          this.config.firestore
            .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
            .where('userId', '==', request.userId)
            .where('definitionId', '==', request.definitionId)
            .where('claim.expiresAt', '>', now)
            .orderBy('claim.expiresAt', 'asc')
            .limit(1)
        ),
        transaction.get(
          this.config.firestore
            .collection(MESSAGE_DIGEST_RUNS_COLLECTION)
            .where('userId', '==', request.userId)
            .where('definitionId', '==', request.definitionId)
            .where('deliveryAuthorization.expiresAt', '>', now)
            .orderBy('deliveryAuthorization.expiresAt', 'asc')
            .limit(1)
        ),
      ]);
      return {
        documents: [],
        cleanupDocuments: [],
        countKey: null,
        nextStage:
          activeRunLeases.empty &&
          activeDispatchClaims.empty &&
          activeDeliveryAuthorizations.empty
            ? 'runs'
            : 'quiescing',
      };
    }
    if (request.stage === 'runs' || request.stage === 'outbox') {
      const collection =
        request.stage === 'runs'
          ? MESSAGE_DIGEST_RUNS_COLLECTION
          : MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION;
      const snapshot = await transaction.get(
        this.config.firestore
          .collection(collection)
          .where('userId', '==', request.userId)
          .where('definitionId', '==', request.definitionId)
          .orderBy(FieldPath.documentId(), 'asc')
          .limit(limit)
      );
      return {
        documents: snapshot.docs.map((document) => ({ ref: document.ref })),
        cleanupDocuments: [],
        countKey: request.stage,
        nextStage: request.stage === 'runs' ? 'outbox' : 'state',
      };
    }
    if (request.stage === 'state' || request.stage === 'definition') {
      const collection =
        request.stage === 'state'
          ? MESSAGE_DIGEST_STATES_COLLECTION
          : MESSAGE_DIGEST_DEFINITIONS_COLLECTION;
      const snapshot = await transaction.get(
        this.config.firestore.collection(collection).doc(request.definitionId)
      );
      return {
        documents: snapshot.exists ? [{ ref: snapshot.ref }] : [],
        cleanupDocuments: [],
        countKey: request.stage,
        nextStage: request.stage === 'state' ? 'definition' : 'legacy',
      };
    }
    const activationSnapshot = await transaction.get(
      this.config.firestore
        .collection(MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION)
        .where('userId', '==', request.userId)
        .where('definitionId', '==', request.definitionId)
        .limit(2)
    );
    if (activationSnapshot.docs.length > 1) throw new Error('MIGRATION_ACTIVATION_CONFLICT');
    const activationDocument = activationSnapshot.docs[0];
    if (activationDocument === undefined) {
      return {
        documents: [],
        cleanupDocuments: [],
        countKey: 'legacy',
        nextStage: 'completed',
      };
    }
    const activation = MessageDigestMigrationActivationDocumentSchema.parse(
      activationDocument.data()
    );
    if (
      activationDocument.id !== activation.migrationId ||
      activation.userId !== request.userId ||
      activation.definitionId !== request.definitionId
    ) {
      throw new Error('MIGRATION_ACTIVATION_CONFLICT');
    }
    if (activation.legacyGroupKey === null) {
      return {
        documents: [],
        cleanupDocuments: [{ ref: activationDocument.ref }],
        countKey: 'legacy',
        nextStage: 'completed',
      };
    }
    const archiveBatch = await this.legacyArchive.readOwnedDeletionBatch(transaction, {
      userId: request.userId,
      legacyGroupKey: activation.legacyGroupKey,
      limit,
    });
    return archiveBatch.documents.length > 0
      ? {
          documents: archiveBatch.documents,
          cleanupDocuments: [],
          countKey: 'legacy',
          nextStage: 'legacy',
        }
      : {
          documents: [],
          cleanupDocuments: [{ ref: activationDocument.ref }],
          countKey: 'legacy',
          nextStage: 'completed',
        };
  }

  private refs(
    definitionId: string,
    runId: string,
    outboxId: string
  ): {
    definition: FirebaseFirestore.DocumentReference;
    state: FirebaseFirestore.DocumentReference;
    run: FirebaseFirestore.DocumentReference;
    outbox: FirebaseFirestore.DocumentReference;
  } {
    return {
      definition: this.config.firestore
        .collection(MESSAGE_DIGEST_DEFINITIONS_COLLECTION)
        .doc(definitionId),
      state: this.config.firestore.collection(MESSAGE_DIGEST_STATES_COLLECTION).doc(definitionId),
      run: this.config.firestore.collection(MESSAGE_DIGEST_RUNS_COLLECTION).doc(runId),
      outbox: this.config.firestore
        .collection(MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION)
        .doc(outboxId),
    };
  }
}

export function createFirestoreMessageDigestStore(
  config: StoreConfig
): FirestoreMessageDigestStore {
  return new FirestoreMessageDigestStore(config);
}

function parseDefinition(value: unknown): MessageDigestDefinitionDocument {
  return MessageDigestDefinitionDocumentSchema.parse(value);
}

function parseState(value: unknown): MessageDigestStateDocument {
  return MessageDigestStateDocumentSchema.parse(value);
}

function parseRun(value: unknown): MessageDigestRunDocument {
  return MessageDigestRunDocumentSchema.parse(value);
}

function toLatestRunProjection(
  run: MessageDigestRunDocument
): NonNullable<MessageDigestDefinitionDocument['latestRun']> {
  return {
    runId: run.runId,
    startedAt: run.createdAt,
    generationStatus: run.generationStatus,
    processingStage: run.processingStage,
    deliveryStatus: run.delivery.status,
  };
}

function nextLatestRunProjection(
  definition: MessageDigestDefinitionDocument,
  run: MessageDigestRunDocument,
  allowInitialize: boolean
): MessageDigestDefinitionDocument['latestRun'] {
  const current = definition.latestRun ?? null;
  if (current === null) return allowInitialize ? toLatestRunProjection(run) : null;
  return current.runId === run.runId ? toLatestRunProjection(run) : current;
}

function withLatestRunProjection(
  definition: MessageDigestDefinitionDocument,
  run: MessageDigestRunDocument,
  options: { allowInitialize?: boolean } = {}
): MessageDigestDefinitionDocument {
  return MessageDigestDefinitionDocumentSchema.parse({
    ...definition,
    latestRun: nextLatestRunProjection(definition, run, options.allowInitialize === true),
  });
}

function parseOutbox(value: unknown): MessageDigestDispatchOutboxDocument {
  return MessageDigestDispatchOutboxDocumentSchema.parse(value);
}

function parseErasure(value: unknown): MessageDigestErasureRequestDocument {
  return MessageDigestErasureRequestDocumentSchema.parse(value);
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('INVALID_LIMIT');
  }
}

function assertTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error('INVALID_TIMESTAMP');
}

function isTimestampCursorValue(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isDefinitionIdCursorValue(value: unknown): value is string {
  return typeof value === 'string' && /^md_[A-Za-z0-9_-]{3,120}$/u.test(value);
}

function assertLeaseTimes(now: string, expiresAt: string): void {
  assertTimestamp(now);
  assertTimestamp(expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(now)) throw new Error('INVALID_LEASE');
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function definitionSortValue(
  definition: MessageDigestDefinitionDocument,
  sort: 'name' | 'updatedAt' | 'nextRunAt'
): string {
  if (sort === 'name') return definition.nameSortKey;
  return definition[sort];
}

function isTerminalRun(run: MessageDigestRunDocument): boolean {
  return ['completed', 'failed', 'skipped_no_activity'].includes(run.generationStatus);
}

function ownsLease(
  run: MessageDigestRunDocument,
  input: { ownerDigest: string; fence: number }
): run is MessageDigestRunDocument & { lease: NonNullable<MessageDigestRunDocument['lease']> } {
  return (
    run.lease !== null &&
    run.lease.ownerDigest === input.ownerDigest &&
    run.lease.fence === input.fence
  );
}

function hasCurrentRunReservation(
  definition: MessageDigestDefinitionDocument,
  state: MessageDigestStateDocument,
  run: MessageDigestRunDocument,
  userId: string
): boolean {
  const pending = state.pendingWindow;
  return (
    definition.status === 'active' &&
    definition.userId === userId &&
    definition.definitionId === run.definitionId &&
    state.userId === userId &&
    state.definitionId === run.definitionId &&
    pending !== null &&
    pending.runId === run.runId &&
    pending.trigger === run.trigger &&
    pending.requestIdDigest === run.requestIdDigest &&
    pending.windowStart === run.windowStart &&
    pending.windowEnd === run.windowEnd &&
    pending.definitionRevision === run.definitionRevision &&
    pending.erasureEpoch === definition.erasureEpoch
  );
}

function retryOutboxMatchesInput(
  outbox: MessageDigestDispatchOutboxDocument,
  input: { userId: string; definitionId: string; runId: string },
  kind: MessageDigestDispatchOutboxDocument['kind']
): boolean {
  return (
    outbox.userId === input.userId &&
    outbox.definitionId === input.definitionId &&
    outbox.runId === input.runId &&
    outbox.kind === kind &&
    outbox.status === 'pending' &&
    outbox.claim === null &&
    outbox.publishedAt === null &&
    outbox.terminalCode === null
  );
}

function sameFrozenDispatch(
  left: MessageDigestDispatchOutboxDocument,
  right: MessageDigestDispatchOutboxDocument
): boolean {
  return (
    left.outboxId === right.outboxId &&
    left.userId === right.userId &&
    left.definitionId === right.definitionId &&
    left.runId === right.runId &&
    left.kind === right.kind &&
    left.payloadJson === right.payloadJson &&
    left.payloadDigest === right.payloadDigest
  );
}

function validateCompletionOutbox(input: {
  userId: string;
  runId: string;
  generationStatus: 'completed' | 'skipped_no_activity';
  deliveryOutbox?: MessageDigestDispatchOutboxDocument | undefined;
}): MessageDigestDispatchOutboxDocument | null {
  if (input.generationStatus === 'skipped_no_activity') {
    if (input.deliveryOutbox !== undefined) throw new Error('INVALID_COMPLETION_OUTBOX');
    return null;
  }
  if (input.deliveryOutbox === undefined) throw new Error('INVALID_COMPLETION_OUTBOX');
  const outbox = MessageDigestDispatchOutboxDocumentSchema.parse(input.deliveryOutbox);
  if (
    outbox.userId !== input.userId ||
    outbox.runId !== input.runId ||
    outbox.kind !== 'whatsapp_delivery' ||
    outbox.status !== 'pending' ||
    outbox.attempts !== 0 ||
    outbox.claim !== null ||
    outbox.publishedAt !== null ||
    outbox.terminalCode !== null
  ) {
    throw new Error('INVALID_COMPLETION_OUTBOX');
  }
  return outbox;
}

function deliveryObservationMatches(
  run: MessageDigestRunDocument,
  delivery:
    | { status: 'sent'; acceptedAt: string }
    | { status: 'ambiguous'; acceptedAt?: string | undefined }
    | { status: 'failed'; failedAt: string; failureCode: string }
): boolean {
  if (run.delivery.status !== delivery.status) return false;
  if (delivery.status === 'sent') return run.delivery.acceptedAt === delivery.acceptedAt;
  if (delivery.status === 'ambiguous') {
    return run.delivery.acceptedAt === (delivery.acceptedAt ?? null);
  }
  return (
    run.delivery.failedAt === delivery.failedAt &&
    run.delivery.failureCode === delivery.failureCode
  );
}

function isVisibleOwnedRun(
  run: MessageDigestRunDocument,
  userId: string,
  definitionId: string
): boolean {
  return (
    run.userId === userId &&
    run.definitionId === definitionId &&
    run.recordRole === 'canonical' &&
    run.visibilityMigrationId === null
  );
}
