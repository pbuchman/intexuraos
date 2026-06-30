import type { IntexAgentSession, IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';

export type SessionRepositorySessionDraft = IntexAgentSession;

export type SessionRepositorySessionUpdate = Partial<
  Pick<
    IntexAgentSession,
    'status' | 'endedAt' | 'lastUserMessageAt' | 'lastAssistantMessageAt' | 'endReason' | 'summary'
  >
> & {
  activeTool?: IntexAgentToolName | null;
};

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
