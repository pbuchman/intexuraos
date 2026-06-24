import type { IntexAgentSession, IntexAgentSessionEvent } from '../sessions/types.js';

export type SessionRepositorySessionDraft = IntexAgentSession;

export type SessionRepositorySessionUpdate = Partial<
  Pick<
    IntexAgentSession,
    | 'status'
    | 'endedAt'
    | 'lastUserMessageAt'
    | 'lastAssistantMessageAt'
    | 'endReason'
    | 'activeTool'
    | 'summary'
  >
>;

export interface SessionRepository {
  listSessions(userId: string): Promise<IntexAgentSession[]>;
  getSession(sessionId: string, userId: string): Promise<IntexAgentSession | null>;
  listEvents(sessionId: string, userId: string): Promise<IntexAgentSessionEvent[]>;
  findOpenSession(userId: string): Promise<IntexAgentSession | null>;
  createSession(draft: SessionRepositorySessionDraft): Promise<IntexAgentSession>;
  updateSession(
    sessionId: string,
    update: SessionRepositorySessionUpdate
  ): Promise<IntexAgentSession>;
  appendEvent(event: IntexAgentSessionEvent): Promise<void>;
}
