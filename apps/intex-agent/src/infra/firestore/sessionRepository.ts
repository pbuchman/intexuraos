import type { Firestore } from '@intexuraos/infra-firestore';
import type {
  SessionRepository,
  SessionRepositorySessionDraft,
  SessionRepositorySessionUpdate,
} from '../../domain/ports/sessionRepository.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
  IntexAgentSessionEventType,
} from '../../domain/sessions/types.js';
import { getSessionTimestampMs } from '../../domain/sessions/sessionTimestamps.js';

export const INTEX_AGENT_SESSIONS_COLLECTION = 'intex_agent_sessions';
export const INTEX_AGENT_SESSION_EVENTS_COLLECTION = 'intex_agent_session_events';

export interface FirestoreSessionRepositoryDeps {
  firestore: Firestore;
}

type SessionDocument = IntexAgentSession;
type SessionEventDocument = IntexAgentSessionEvent;

const OPEN_STATUSES = new Set(['active', 'waiting_for_user', 'executing_tool']);
const EVENT_TYPE_ORDER: Record<IntexAgentSessionEventType, number> = {
  session_started: 0,
  user_message: 10,
  tool_call_started: 20,
  tool_call_completed: 30,
  tool_call_failed: 30,
  unsupported_request: 40,
  clarification_requested: 40,
  assistant_message: 50,
  session_closed: 90,
};

export class FirestoreSessionRepository implements SessionRepository {
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
    return session.userId === userId ? session : null;
  }

  async listEvents(sessionId: string, userId: string): Promise<IntexAgentSessionEvent[]> {
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
      .filter((session) => statuses.has(session.status))
      .sort((a, b) => getSessionTimestampMs(b.lastUserMessageAt) - getSessionTimestampMs(a.lastUserMessageAt));

    return sessions[0] ?? null;
  }

  async createSession(draft: SessionRepositorySessionDraft): Promise<IntexAgentSession> {
    await this.firestore.collection(INTEX_AGENT_SESSIONS_COLLECTION).doc(draft.id).set(toSessionDocument(draft));
    return draft;
  }

  async updateSession(
    sessionId: string,
    update: SessionRepositorySessionUpdate
  ): Promise<IntexAgentSession> {
    const docRef = this.firestore.collection(INTEX_AGENT_SESSIONS_COLLECTION).doc(sessionId);
    await docRef.update(update);
    const updated = await docRef.get();
    return toSession(updated.id, updated.data() as SessionDocument);
  }

  async appendEvent(event: IntexAgentSessionEvent): Promise<void> {
    await this.firestore
      .collection(INTEX_AGENT_SESSION_EVENTS_COLLECTION)
      .doc(event.id)
      .set(toEventDocument(event));
  }
}

function toSession(id: string, doc: SessionDocument): IntexAgentSession {
  return { ...doc, id };
}

function toEvent(id: string, doc: SessionEventDocument): IntexAgentSessionEvent {
  return { ...doc, id };
}

function toSessionDocument(session: IntexAgentSession): SessionDocument {
  return { ...session };
}

function toEventDocument(event: IntexAgentSessionEvent): SessionEventDocument {
  return { ...event };
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
