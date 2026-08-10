import { createHash } from 'node:crypto';

import {
  canonicalMatrixCorpusStrictToolMockProfileV1,
  matrixCorpusExpectedToolScheduleV1Schema,
  strictToolMockProfileV1Schema,
} from '@intexuraos/http-contracts';
import { FieldValue, type Firestore } from '@intexuraos/infra-firestore';
import type {
  MatrixCorpusEventMutationResult,
  MatrixCorpusEventsGetResult,
  MatrixCorpusSession,
  MatrixCorpusSessionFailureCode,
  MatrixCorpusSessionGetResult,
  MatrixCorpusSessionIdentity,
  MatrixCorpusSessionMutationResult,
  MatrixCorpusSessionRepository,
  MatrixCorpusSessionUpdate,
  SessionRepository,
  SessionRepositorySessionDraft,
  SessionRepositorySessionUpdate,
} from '../../domain/ports/sessionRepository.js';
import type {
  IntexAgentMatrixCorpusProfileV1,
  IntexAgentSession,
  IntexAgentSessionEvent,
  IntexAgentSessionEventType,
  IntexAgentToolName,
} from '../../domain/sessions/types.js';
import { getSessionTimestampMs } from '../../domain/sessions/sessionTimestamps.js';
import {
  INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION,
  parseMatrixCorpusRunContextDocument,
} from './matrixCorpusContextRepository.js';
import {
  INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION,
  parseMatrixCorpusRunManifestDocument,
} from './matrixCorpusManifestRepository.js';

export const INTEX_AGENT_SESSIONS_COLLECTION = 'intex_agent_sessions';
export const INTEX_AGENT_SESSION_EVENTS_COLLECTION = 'intex_agent_session_events';

export interface FirestoreSessionRepositoryDeps {
  firestore: Firestore;
}

type SessionDocument = Omit<IntexAgentSession, 'activeTool'> & {
  activeTool?: IntexAgentToolName | null;
};
type SessionEventDocument = IntexAgentSessionEvent;

const OPEN_STATUSES = new Set(['active', 'waiting_for_user', 'executing_tool']);
const MAX_MATRIX_CORPUS_EVENT_SEQUENCE = 10_000;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const FENCE_PATTERN = /^[1-9][0-9]{0,19}$/u;
const profileKeys = [
  'agentModel',
  'evaluatorModel',
  'executionMode',
  'expectedToolSchedule',
  'kind',
  'leaseFence',
  'mockProfile',
  'mockProfileDigest',
  'promptPreferencesDigest',
  'promptPreferencesVersion',
  'runId',
  'runtimeAudience',
  'scenarioId',
  'scenarioLabel',
  'scenarioNumber',
  'userTimeZone',
  'version',
] as const;
const matrixSessionAllowedKeys = new Set([
  'activeTool',
  'channel',
  'endReason',
  'endedAt',
  'id',
  'lastAssistantMessageAt',
  'lastEventSequence',
  'lastUserMessageAt',
  'matrixCorpusProfile',
  'startReason',
  'startedAt',
  'status',
  'summary',
  'userId',
]);
const matrixEventKeys = [
  'createdAt',
  'eventSequence',
  'id',
  'payload',
  'sessionId',
  'type',
  'userId',
] as const;
const matrixEventInputKeys = matrixEventKeys.filter(
  (key) => key !== 'eventSequence'
);
const sessionStatuses = new Set([
  'active',
  'waiting_for_user',
  'executing_tool',
  'completed',
  'unsupported',
  'expired',
  'cancelled',
  'superseded',
]);
const sessionStartReasons = new Set([
  'no_active_session',
  'previous_completed',
  'previous_expired',
  'user_requested_new_session',
  'previous_superseded',
]);
const sessionEndReasons = new Set([
  'tool_completed',
  'tool_failed',
  'unsupported_request',
  'timeout',
  'cancelled_by_user',
  'superseded_by_user',
]);
const EVENT_TYPE_ORDER: Record<IntexAgentSessionEventType, number> = {
  session_started: 0,
  user_message: 10,
  confirmation_requested: 20,
  confirmation_resolved: 20,
  matrix_corpus_execution_boundary: 22,
  tool_call_started: 20,
  llm_call_usage: 25,
  llm_usage_summary: 35,
  tool_call_completed: 30,
  tool_call_failed: 30,
  turn_processing_completed: 60,
  turn_processing_failed: 60,
  agent_fallback: 39,
  unsupported_request: 40,
  clarification_requested: 40,
  assistant_message: 50,
  session_closed: 90,
};

export class FirestoreSessionRepository
  implements SessionRepository, MatrixCorpusSessionRepository
{
  private readonly firestore: Firestore;

  constructor(deps: FirestoreSessionRepositoryDeps) {
    this.firestore = deps.firestore;
  }

  async listSessions(userId: string): Promise<IntexAgentSession[]> {
    const snapshot = await this.firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .where('userId', '==', userId)
      .get();

    return snapshot.docs
      .map((doc) => toSession(doc.id, doc.data() as SessionDocument))
      .filter((session) => session.matrixCorpusProfile === undefined)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getSession(sessionId: string, userId: string): Promise<IntexAgentSession | null> {
    const doc = await this.firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc(sessionId)
      .get();

    if (!doc.exists) {
      return null;
    }

    const session = toSession(doc.id, doc.data() as SessionDocument);
    return session.userId === userId && session.matrixCorpusProfile === undefined ? session : null;
  }

  async listEvents(sessionId: string, userId: string): Promise<IntexAgentSessionEvent[]> {
    const sessionSnapshot = await this.firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc(sessionId)
      .get();
    if (!sessionSnapshot.exists) return [];
    const session = toSession(sessionSnapshot.id, sessionSnapshot.data() as SessionDocument);
    if (session.userId !== userId || session.matrixCorpusProfile !== undefined) return [];
    const snapshot = await this.firestore
      .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
      .where('sessionId', '==', sessionId)
      .get();

    return snapshot.docs
      .map((doc) => toEvent(doc.id, doc.data() as SessionEventDocument))
      .filter((event) => event.userId === userId)
      .sort(compareSessionEvents);
  }

  async findOpenSession(userId: string): Promise<IntexAgentSession | null> {
    return await this.findNewestSessionByStatuses(userId, OPEN_STATUSES);
  }

  async findContinuableSession(userId: string): Promise<IntexAgentSession | null> {
    return await this.findNewestSessionByStatuses(userId, OPEN_STATUSES);
  }

  private async findNewestSessionByStatuses(
    userId: string,
    statuses: Set<string>
  ): Promise<IntexAgentSession | null> {
    const snapshot = await this.firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .where('userId', '==', userId)
      .get();

    const sessions = snapshot.docs
      .map((doc) => toSession(doc.id, doc.data() as SessionDocument))
      .filter(
        (session) =>
          session.matrixCorpusProfile === undefined && statuses.has(session.status)
      )
      .sort((a, b) => getSessionTimestampMs(b.lastUserMessageAt) - getSessionTimestampMs(a.lastUserMessageAt));

    return sessions[0] ?? null;
  }

  async createSession(draft: SessionRepositorySessionDraft): Promise<IntexAgentSession> {
    if (draft.matrixCorpusProfile !== undefined || draft.lastEventSequence !== undefined)
      throw new Error('Matrix corpus session requires exact lane');
    await this.firestore.collection(INTEX_AGENT_SESSIONS_COLLECTION).doc(draft.id).set(toSessionDocument(draft));
    return draft;
  }

  async updateSession(
    sessionId: string,
    update: SessionRepositorySessionUpdate
  ): Promise<IntexAgentSession> {
    const docRef = this.firestore.collection(INTEX_AGENT_SESSIONS_COLLECTION).doc(sessionId);
    const current = await docRef.get();
    if (current.exists) {
      const session = toSession(current.id, current.data() as SessionDocument);
      if (session.matrixCorpusProfile !== undefined)
        throw new Error('Matrix corpus session requires exact lane');
    }
    await docRef.update(toSessionUpdateDocument(update));
    const updated = await docRef.get();
    return toSession(updated.id, updated.data() as SessionDocument);
  }

  async appendEvent(event: IntexAgentSessionEvent): Promise<void> {
    const sessionRef = this.firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc(event.sessionId);
    const sessionSnapshot = await sessionRef.get();
    if (sessionSnapshot.exists) {
      const session = toSession(
        sessionSnapshot.id,
        sessionSnapshot.data() as SessionDocument
      );
      if (session.matrixCorpusProfile !== undefined)
        throw new Error('Matrix corpus session requires exact lane');
    }
    await this.firestore
      .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
      .doc(event.id)
      .set(toEventDocument(event));
  }

  async createMatrixCorpusSession(input: Readonly<{
    identity: MatrixCorpusSessionIdentity;
    session: MatrixCorpusSession;
    now: string;
  }>): Promise<MatrixCorpusSessionMutationResult> {
    if (
      !isValidMatrixIdentity(input.identity) ||
      !isValidMatrixSession(input.session) ||
      !isRfc3339(input.now)
    )
      return matrixFailure('INVALID_INPUT');
    if (!sessionMatchesIdentity(input.session, input.identity))
      return matrixFailure('INVALID_INPUT');

    const sessionRef = this.firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc(input.identity.sessionId);
    const manifestRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(input.identity.runId);
    const contextRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc(input.identity.runId);
    return await this.firestore.runTransaction(async (transaction) => {
      const [sessionSnapshot, manifestSnapshot, contextSnapshot] = await Promise.all([
        transaction.get(sessionRef),
        transaction.get(manifestRef),
        transaction.get(contextRef),
      ]);
      if (!manifestSnapshot.exists) return matrixFailure('MANIFEST_MISMATCH');
      const manifest = parseMatrixCorpusRunManifestDocument(manifestSnapshot.data());
      if (
        manifest?.runId !== input.identity.runId ||
        manifest.userId !== input.identity.userId ||
        manifest.leaseFence !== input.identity.leaseFence ||
        manifest.terminalCandidate !== null
      )
        return matrixFailure('MANIFEST_MISMATCH');
      if (!isActiveRunContext(contextSnapshot, input.identity, input.now))
        return matrixFailure('RUN_NOT_ACTIVE');

      const profile = input.session.matrixCorpusProfile;
      const binding = {
        scenarioId: profile.scenarioId,
        scenarioNumber: profile.scenarioNumber,
        scenarioLabel: profile.scenarioLabel,
        sessionId: input.session.id,
      };
      const manifestBinding = manifest.scenarioBindings.find(
        (candidate) => candidate.scenarioId === profile.scenarioId
      );

      if (sessionSnapshot.exists) {
        const existing = parseMatrixCorpusSessionDocument(
          sessionSnapshot.id,
          sessionSnapshot.data()
        );
        if (existing === undefined) {
          const ordinary = toSession(
            sessionSnapshot.id,
            sessionSnapshot.data() as SessionDocument
          );
          return ordinary.matrixCorpusProfile === undefined
            ? matrixFailure('INVALID_LANE')
            : matrixFailure('CORRUPT_SESSION');
        }
        if (!sessionMatchesIdentity(existing, input.identity))
          return matrixFailure('CORRELATED_REPLAY_CONFLICT');
        if (
          stableJson(existing) !== stableJson(input.session) ||
          manifestBinding === undefined ||
          stableJson(manifestBinding) !== stableJson(binding)
        )
          return matrixFailure('CORRELATED_REPLAY_CONFLICT');
        return matrixSessionSuccess('already_applied', existing);
      }

      if (
        manifestBinding !== undefined ||
        profile.scenarioNumber !== manifest.scenarioBindings.length + 1 ||
        manifest.scenarioBindings.some(
          (candidate) =>
            candidate.sessionId === input.session.id ||
            candidate.scenarioNumber === profile.scenarioNumber
        )
      )
        return matrixFailure('MANIFEST_MISMATCH');

      transaction.set(sessionRef, cloneMatrixSession(input.session));
      transaction.set(manifestRef, {
        ...manifest,
        scenarioBindings: [...manifest.scenarioBindings, binding],
      });
      return matrixSessionSuccess('applied', input.session);
    });
  }

  async getMatrixCorpusSessionExact(
    identity: MatrixCorpusSessionIdentity
  ): Promise<MatrixCorpusSessionGetResult> {
    if (!isValidMatrixIdentity(identity)) return matrixFailure('INVALID_INPUT');
    const snapshot = await this.firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc(identity.sessionId)
      .get();
    if (!snapshot.exists) return matrixFailure('NOT_FOUND');
    const session = parseMatrixCorpusSessionDocument(snapshot.id, snapshot.data());
    if (session === undefined) {
      const ordinary = toSession(snapshot.id, snapshot.data() as SessionDocument);
      return ordinary.matrixCorpusProfile === undefined
        ? matrixFailure('INVALID_LANE')
        : matrixFailure('CORRUPT_SESSION');
    }
    if (!sessionMatchesIdentity(session, identity))
      return matrixFailure('CORRELATED_REPLAY_CONFLICT');
    return { ok: true, session: cloneMatrixSession(session) };
  }

  async updateMatrixCorpusSessionExact(input: Readonly<{
    identity: MatrixCorpusSessionIdentity;
    update: MatrixCorpusSessionUpdate;
    now: string;
  }>): Promise<MatrixCorpusSessionMutationResult> {
    if (!isValidMatrixIdentity(input.identity) || !isRfc3339(input.now))
      return matrixFailure('INVALID_INPUT');
    const ref = this.firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc(input.identity.sessionId);
    const manifestRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(input.identity.runId);
    const contextRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc(input.identity.runId);
    return await this.firestore.runTransaction(async (transaction) => {
      const [snapshot, manifestSnapshot, contextSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(manifestRef),
        transaction.get(contextRef),
      ]);
      if (!isActiveRunState(manifestSnapshot, contextSnapshot, input.identity, input.now))
        return matrixFailure('RUN_NOT_ACTIVE');
      if (!snapshot.exists) return matrixFailure('NOT_FOUND');
      const session = parseMatrixCorpusSessionDocument(snapshot.id, snapshot.data());
      if (session === undefined) return matrixFailure('CORRUPT_SESSION');
      if (!sessionMatchesIdentity(session, input.identity))
        return matrixFailure('CORRELATED_REPLAY_CONFLICT');
      const updated = applyMatrixSessionUpdate(session, input.update);
      if (!isValidMatrixSession(updated)) return matrixFailure('INVALID_INPUT');
      transaction.set(ref, cloneMatrixSession(updated));
      return matrixSessionSuccess('applied', updated);
    });
  }

  async appendMatrixCorpusEvent(input: Readonly<{
    identity: MatrixCorpusSessionIdentity;
    event: IntexAgentSessionEvent;
    sessionUpdate?: MatrixCorpusSessionUpdate;
    now: string;
  }>): Promise<MatrixCorpusEventMutationResult> {
    if (
      !isValidMatrixIdentity(input.identity) ||
      !isValidMatrixEventInput(input.event) ||
      !isRfc3339(input.now)
    )
      return matrixFailure('INVALID_INPUT');
    const sessionRef = this.firestore
      .collection(INTEX_AGENT_SESSIONS_COLLECTION)
      .doc(input.identity.sessionId);
    const eventRef = this.firestore
      .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
      .doc(input.event.id);
    const manifestRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_MANIFESTS_COLLECTION)
      .doc(input.identity.runId);
    const contextRef = this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_RUN_CONTEXTS_COLLECTION)
      .doc(input.identity.runId);
    return await this.firestore.runTransaction(async (transaction) => {
      const [sessionSnapshot, eventSnapshot, manifestSnapshot, contextSnapshot] = await Promise.all([
        transaction.get(sessionRef),
        transaction.get(eventRef),
        transaction.get(manifestRef),
        transaction.get(contextRef),
      ]);
      if (!sessionSnapshot.exists) return matrixFailure('NOT_FOUND');
      const session = parseMatrixCorpusSessionDocument(
        sessionSnapshot.id,
        sessionSnapshot.data()
      );
      if (session === undefined) return matrixFailure('CORRUPT_SESSION');
      if (!sessionMatchesIdentity(session, input.identity))
        return matrixFailure('CORRELATED_REPLAY_CONFLICT');
      if (
        input.event.sessionId !== input.identity.sessionId ||
        input.event.userId !== input.identity.userId
      )
        return matrixFailure('CORRELATED_REPLAY_CONFLICT');

      if (eventSnapshot.exists) {
        const existing = parseMatrixCorpusEventDocument(eventSnapshot.data());
        if (existing === undefined) return matrixFailure('CORRUPT_EVENT');
        return stableJson(withoutEventSequence(existing)) === stableJson(input.event)
          ? {
              ok: true,
              disposition: 'already_applied',
              sequence: Number(existing.eventSequence),
            }
          : matrixFailure('CORRELATED_REPLAY_CONFLICT');
      }
      if (!isActiveRunState(manifestSnapshot, contextSnapshot, input.identity, input.now))
        return matrixFailure('RUN_NOT_ACTIVE');
      if (session.lastEventSequence >= MAX_MATRIX_CORPUS_EVENT_SEQUENCE)
        return matrixFailure('SEQUENCE_EXHAUSTED');
      const updatedSession =
        input.sessionUpdate === undefined
          ? session
          : applyMatrixSessionUpdate(session, input.sessionUpdate);
      if (!isValidMatrixSession(updatedSession)) return matrixFailure('INVALID_INPUT');
      const sequence = session.lastEventSequence + 1;
      const storedEvent = { ...cloneEvent(input.event), eventSequence: sequence };

      transaction.set(eventRef, storedEvent);
      transaction.set(sessionRef, { ...updatedSession, lastEventSequence: sequence });
      return { ok: true, disposition: 'applied', sequence };
    });
  }

  async listMatrixCorpusEventsExact(
    identity: MatrixCorpusSessionIdentity
  ): Promise<MatrixCorpusEventsGetResult> {
    const sessionResult = await this.getMatrixCorpusSessionExact(identity);
    if (!sessionResult.ok) return sessionResult;
    const snapshot = await this.firestore
      .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
      .where('sessionId', '==', identity.sessionId)
      .get();
    const events = snapshot.docs.map((document) =>
      parseMatrixCorpusEventDocument(document.data())
    );
    if (events.some((event) => event === undefined)) return matrixFailure('CORRUPT_EVENT');
    const exactEvents = events as IntexAgentSessionEvent[];
    if (
      exactEvents.some((event) => event.userId !== identity.userId) ||
      exactEvents.length !== sessionResult.session.lastEventSequence
    )
      return matrixFailure('CORRUPT_EVENT');
    exactEvents.sort(
      (left, right) => Number(left.eventSequence) - Number(right.eventSequence)
    );
    if (
      exactEvents.some((event, index) => event.eventSequence !== index + 1)
    )
      return matrixFailure('CORRUPT_EVENT');
    return { ok: true, events: exactEvents.map(cloneEvent) };
  }
}

function toSession(id: string, doc: SessionDocument): IntexAgentSession {
  const { activeTool, ...rest } = doc;
  const cloned = {
    ...rest,
    ...(rest.matrixCorpusProfile !== undefined
      ? { matrixCorpusProfile: cloneProfile(rest.matrixCorpusProfile) }
      : {}),
    id,
  };
  if (activeTool === undefined || activeTool === null) {
    return cloned;
  }
  return { ...cloned, activeTool };
}

function toEvent(id: string, doc: SessionEventDocument): IntexAgentSessionEvent {
  return cloneEvent({ ...doc, id });
}

function toSessionDocument(session: IntexAgentSession): SessionDocument {
  return { ...session };
}

function toSessionUpdateDocument(update: SessionRepositorySessionUpdate): Record<string, unknown> {
  const documentUpdate: Record<string, unknown> = { ...update };
  if (update.activeTool === null) {
    documentUpdate['activeTool'] = FieldValue.delete();
  }
  return documentUpdate;
}

function toEventDocument(event: IntexAgentSessionEvent): SessionEventDocument {
  return cloneEvent(event);
}

function compareSessionEvents(a: IntexAgentSessionEvent, b: IntexAgentSessionEvent): number {
  const timeDiff = getSessionTimestampMs(a.createdAt) - getSessionTimestampMs(b.createdAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  const typeDiff = EVENT_TYPE_ORDER[a.type] - EVENT_TYPE_ORDER[b.type];
  if (typeDiff !== 0) {
    return typeDiff;
  }

  return a.id.localeCompare(b.id);
}

function matrixFailure(
  code: MatrixCorpusSessionFailureCode
): Readonly<{ ok: false; code: MatrixCorpusSessionFailureCode }> {
  return { ok: false, code } as const;
}

function matrixSessionSuccess(
  disposition: 'applied' | 'already_applied',
  session: MatrixCorpusSession
): MatrixCorpusSessionMutationResult {
  return { ok: true, disposition, session: cloneMatrixSession(session) };
}

export function parseMatrixCorpusSessionDocument(
  id: string,
  value: unknown
): MatrixCorpusSession | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !matrixSessionAllowedKeys.has(key))) return undefined;
  if (record['id'] !== id) return undefined;
  if (!isValidProfile(record['matrixCorpusProfile'])) return undefined;
  const session = toSession(id, record as unknown as SessionDocument);
  return isValidMatrixSession(session) ? session : undefined;
}

function isValidMatrixSession(value: unknown): value is MatrixCorpusSession {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    SAFE_ID_PATTERN.test(value['id']) &&
    typeof value['userId'] === 'string' &&
    SAFE_ID_PATTERN.test(value['userId']) &&
    value['channel'] === 'whatsapp' &&
    typeof value['status'] === 'string' &&
    sessionStatuses.has(value['status']) &&
    typeof value['startedAt'] === 'string' &&
    isRfc3339(value['startedAt']) &&
    typeof value['lastUserMessageAt'] === 'string' &&
    isRfc3339(value['lastUserMessageAt']) &&
    (value['endedAt'] === undefined ||
      (typeof value['endedAt'] === 'string' && isRfc3339(value['endedAt']))) &&
    (value['lastAssistantMessageAt'] === undefined ||
      (typeof value['lastAssistantMessageAt'] === 'string' &&
        isRfc3339(value['lastAssistantMessageAt']))) &&
    typeof value['startReason'] === 'string' &&
    sessionStartReasons.has(value['startReason']) &&
    (value['endReason'] === undefined ||
      (typeof value['endReason'] === 'string' && sessionEndReasons.has(value['endReason']))) &&
    (value['activeTool'] === undefined ||
      (typeof value['activeTool'] === 'string' && isToolName(value['activeTool']))) &&
    (value['summary'] === undefined || typeof value['summary'] === 'string') &&
    isValidProfile(value['matrixCorpusProfile']) &&
    Number.isInteger(value['lastEventSequence']) &&
    Number(value['lastEventSequence']) >= 0 &&
    Number(value['lastEventSequence']) <= MAX_MATRIX_CORPUS_EVENT_SEQUENCE
  );
}

function isValidProfile(value: unknown): value is IntexAgentMatrixCorpusProfileV1 {
  if (!hasExactKeys(value, profileKeys)) return false;
  const parsedMockProfile = strictToolMockProfileV1Schema.safeParse(value['mockProfile']);
  const parsedExpectedSchedule = matrixCorpusExpectedToolScheduleV1Schema.safeParse(
    value['expectedToolSchedule']
  );
  if (typeof value['scenarioLabel'] !== 'string') return false;
  const scenarioLabel = value['scenarioLabel'];
  let canonicalMockProfile: string;
  try {
    canonicalMockProfile = canonicalMatrixCorpusStrictToolMockProfileV1(value['mockProfile']);
  } catch {
    return false;
  }
  return (
    value['version'] === 1 &&
    value['kind'] === 'matrix_corpus' &&
    value['runtimeAudience'] === 'hetzner-prod' &&
    typeof value['leaseFence'] === 'string' &&
    FENCE_PATTERN.test(value['leaseFence']) &&
    typeof value['runId'] === 'string' &&
    SAFE_ID_PATTERN.test(value['runId']) &&
    typeof value['scenarioId'] === 'string' &&
    SAFE_ID_PATTERN.test(value['scenarioId']) &&
    Number.isInteger(value['scenarioNumber']) &&
    Number(value['scenarioNumber']) >= 1 &&
    Number(value['scenarioNumber']) <= 20 &&
    scenarioLabel.length >= 1 &&
    scenarioLabel.length <= 128 &&
    scenarioLabel.trim() === scenarioLabel &&
    value['executionMode'] === 'strict_mock_tools' &&
    (value['agentModel'] === 'or:deepseek/deepseek-v4-flash' ||
      value['agentModel'] === 'or:minimax/minimax-m3') &&
    value['evaluatorModel'] === 'or:minimax/minimax-m3' &&
    Number.isInteger(value['promptPreferencesVersion']) &&
    Number(value['promptPreferencesVersion']) >= 0 &&
    typeof value['promptPreferencesDigest'] === 'string' &&
    SHA_256_PATTERN.test(value['promptPreferencesDigest']) &&
    typeof value['userTimeZone'] === 'string' &&
    isIanaTimeZone(value['userTimeZone']) &&
    parsedMockProfile.success &&
    parsedExpectedSchedule.success &&
    typeof value['mockProfileDigest'] === 'string' &&
    SHA_256_PATTERN.test(value['mockProfileDigest']) &&
    createHash('sha256').update(canonicalMockProfile, 'utf8').digest('hex') ===
      value['mockProfileDigest']
  );
}

function isValidMatrixIdentity(identity: MatrixCorpusSessionIdentity): boolean {
  return (
    SAFE_ID_PATTERN.test(identity.runId) &&
    SAFE_ID_PATTERN.test(identity.scenarioId) &&
    SAFE_ID_PATTERN.test(identity.sessionId) &&
    SAFE_ID_PATTERN.test(identity.userId) &&
    FENCE_PATTERN.test(identity.leaseFence)
  );
}

function sessionMatchesIdentity(
  session: MatrixCorpusSession,
  identity: MatrixCorpusSessionIdentity
): boolean {
  const profile = session.matrixCorpusProfile;
  return (
    session.id === identity.sessionId &&
    session.userId === identity.userId &&
    profile.runId === identity.runId &&
    profile.scenarioId === identity.scenarioId &&
    profile.leaseFence === identity.leaseFence
  );
}

function isValidMatrixEventInput(event: unknown): event is IntexAgentSessionEvent {
  if (!hasExactKeys(event, matrixEventInputKeys)) return false;
  return (
    typeof event['id'] === 'string' &&
    SAFE_ID_PATTERN.test(event['id']) &&
    typeof event['sessionId'] === 'string' &&
    SAFE_ID_PATTERN.test(event['sessionId']) &&
    typeof event['userId'] === 'string' &&
    SAFE_ID_PATTERN.test(event['userId']) &&
    typeof event['type'] === 'string' &&
    Object.hasOwn(EVENT_TYPE_ORDER, event['type']) &&
    isRecord(event['payload']) &&
    Buffer.byteLength(stableJson(event['payload']), 'utf8') <= 64 * 1024 &&
    typeof event['createdAt'] === 'string' &&
    isRfc3339(event['createdAt'])
  );
}

export function parseMatrixCorpusEventDocument(
  value: unknown
): IntexAgentSessionEvent | undefined {
  if (!hasExactKeys(value, matrixEventKeys)) return undefined;
  const event = value as unknown as IntexAgentSessionEvent;
  return Number.isInteger(event.eventSequence) &&
    Number(event.eventSequence) >= 1 &&
    isValidMatrixEventInput(withoutEventSequence(event))
    ? cloneEvent(event)
    : undefined;
}

function withoutEventSequence(
  event: IntexAgentSessionEvent
): IntexAgentSessionEvent {
  const { eventSequence: _sequence, ...input } = event;
  return input;
}

type FirestoreSnapshotLike = Readonly<{
  exists: boolean;
  data(): unknown;
}>;

function isActiveRunState(
  manifestSnapshot: FirestoreSnapshotLike,
  contextSnapshot: FirestoreSnapshotLike,
  identity: MatrixCorpusSessionIdentity,
  now: string
): boolean {
  if (!manifestSnapshot.exists) return false;
  const manifest = parseMatrixCorpusRunManifestDocument(manifestSnapshot.data());
  return (
    manifest?.runId === identity.runId &&
    manifest.userId === identity.userId &&
    manifest.leaseFence === identity.leaseFence &&
    manifest.terminalCandidate === null &&
    isActiveRunContext(contextSnapshot, identity, now)
  );
}

function isActiveRunContext(
  contextSnapshot: FirestoreSnapshotLike,
  identity: MatrixCorpusSessionIdentity,
  now: string
): boolean {
  if (!contextSnapshot.exists) return false;
  const context = parseMatrixCorpusRunContextDocument(contextSnapshot.data());
  return (
    context?.status === 'active' &&
    context.runId === identity.runId &&
    context.userId === identity.userId &&
    context.leaseFence === identity.leaseFence &&
    context.invalidatedAt === null &&
    Date.parse(now) < Date.parse(context.expiresAt)
  );
}

function applyMatrixSessionUpdate(
  session: MatrixCorpusSession,
  update: MatrixCorpusSessionUpdate
): MatrixCorpusSession {
  const updated = { ...session, ...update };
  if (update.activeTool === null) {
    const { activeTool: _activeTool, ...withoutActiveTool } = updated;
    return withoutActiveTool as MatrixCorpusSession;
  }
  return updated as MatrixCorpusSession;
}

function cloneMatrixSession(session: MatrixCorpusSession): MatrixCorpusSession {
  return {
    ...session,
    matrixCorpusProfile: cloneProfile(session.matrixCorpusProfile),
  };
}

function cloneProfile(profile: IntexAgentMatrixCorpusProfileV1): IntexAgentMatrixCorpusProfileV1 {
  return {
    ...profile,
    mockProfile: structuredClone(profile.mockProfile),
    expectedToolSchedule: structuredClone(profile.expectedToolSchedule),
  };
}

function cloneEvent(event: IntexAgentSessionEvent): IntexAgentSessionEvent {
  return { ...event, payload: structuredClone(event.payload) };
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
  if (typeof value !== 'object' || value === null) {
    return JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isToolName(value: string): value is IntexAgentToolName {
  return new Set([
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
  ]).has(value);
}
