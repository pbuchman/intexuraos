import type {
  IntexAgentMatrixCorpusProfileV1,
  IntexAgentSession,
  IntexAgentSessionEvent,
  IntexAgentToolName,
} from '../sessions/types.js';

export type SessionRepositorySessionDraft = IntexAgentSession;

export type MatrixCorpusSession = IntexAgentSession & {
  matrixCorpusProfile: IntexAgentMatrixCorpusProfileV1;
  lastEventSequence: number;
};

export interface MatrixCorpusSessionIdentity {
  runId: string;
  scenarioId: string;
  sessionId: string;
  userId: string;
  leaseFence: string;
}

export type MatrixCorpusSessionFailureCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_LANE'
  | 'CORRELATED_REPLAY_CONFLICT'
  | 'SEQUENCE_CONFLICT'
  | 'SEQUENCE_EXHAUSTED'
  | 'MANIFEST_MISMATCH'
  | 'RUN_NOT_ACTIVE'
  | 'CORRUPT_SESSION'
  | 'CORRUPT_EVENT';

export type MatrixCorpusSessionMutationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      session: MatrixCorpusSession;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusSessionFailureCode }>;

export type MatrixCorpusSessionGetResult =
  | Readonly<{ ok: true; session: MatrixCorpusSession }>
  | Readonly<{ ok: false; code: MatrixCorpusSessionFailureCode }>;

export type MatrixCorpusEventMutationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      sequence: number;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusSessionFailureCode }>;

export type MatrixCorpusEventsGetResult =
  | Readonly<{ ok: true; events: IntexAgentSessionEvent[] }>
  | Readonly<{ ok: false; code: MatrixCorpusSessionFailureCode }>;

export type SessionRepositorySessionUpdate = Partial<
  Pick<
    IntexAgentSession,
    'status' | 'endedAt' | 'lastUserMessageAt' | 'lastAssistantMessageAt' | 'endReason' | 'summary'
  >
> & {
  activeTool?: IntexAgentToolName | null;
};

export type MatrixCorpusSessionUpdate = SessionRepositorySessionUpdate &
  Partial<Pick<IntexAgentSession, 'startReason'>>;

export interface SessionRepository {
  listSessions(userId: string): Promise<IntexAgentSession[]>;
  getSession(sessionId: string, userId: string): Promise<IntexAgentSession | null>;
  listEvents(sessionId: string, userId: string): Promise<IntexAgentSessionEvent[]>;
  findOpenSession(userId: string): Promise<IntexAgentSession | null>;
  findContinuableSession(userId: string): Promise<IntexAgentSession | null>;
  createSession(draft: SessionRepositorySessionDraft): Promise<IntexAgentSession>;
  updateSession(
    sessionId: string,
    update: SessionRepositorySessionUpdate
  ): Promise<IntexAgentSession>;
  appendEvent(event: IntexAgentSessionEvent): Promise<void>;
}

export interface MatrixCorpusSessionRepository {
  createMatrixCorpusSession(input: Readonly<{
    identity: MatrixCorpusSessionIdentity;
    session: MatrixCorpusSession;
    now: string;
  }>): Promise<MatrixCorpusSessionMutationResult>;
  getMatrixCorpusSessionExact(
    identity: MatrixCorpusSessionIdentity
  ): Promise<MatrixCorpusSessionGetResult>;
  updateMatrixCorpusSessionExact(input: Readonly<{
    identity: MatrixCorpusSessionIdentity;
    update: MatrixCorpusSessionUpdate;
    now: string;
  }>): Promise<MatrixCorpusSessionMutationResult>;
  appendMatrixCorpusEvent(input: Readonly<{
    identity: MatrixCorpusSessionIdentity;
    event: IntexAgentSessionEvent;
    sessionUpdate?: MatrixCorpusSessionUpdate;
    now: string;
  }>): Promise<MatrixCorpusEventMutationResult>;
  listMatrixCorpusEventsExact(
    identity: MatrixCorpusSessionIdentity
  ): Promise<MatrixCorpusEventsGetResult>;
}
