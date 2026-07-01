import { config } from '@/config';
import type {
  ConversationAssistantSession,
  ConversationAssistantTurn,
  ConversationAssistantSessionsResponse,
  ConversationAssistantTurnsResponse,
  CreateConversationAssistantSessionRequest,
  SendConversationAssistantTurnRequest,
} from '@/types';
import { apiRequest } from './apiClient.js';

const CONVERSATION_ASSISTANT_SESSIONS_PATH = '/conversation-assistant/sessions';

interface ConversationAssistantSessionResponse {
  session: ConversationAssistantSession;
}

interface CreateConversationAssistantSessionResponse {
  session: ConversationAssistantSession;
  turns: ConversationAssistantTurn[];
}

function getSessionPath(sessionId: string): string {
  return `${CONVERSATION_ASSISTANT_SESSIONS_PATH}/${encodeURIComponent(sessionId)}`;
}

export async function listConversationAssistantSessions(
  accessToken: string
): Promise<ConversationAssistantSessionsResponse> {
  return await apiRequest<ConversationAssistantSessionsResponse>(
    config.whatsappServiceUrl,
    CONVERSATION_ASSISTANT_SESSIONS_PATH,
    accessToken
  );
}

export async function createConversationAssistantSession(
  accessToken: string,
  request: CreateConversationAssistantSessionRequest
): Promise<ConversationAssistantSession> {
  const response = await apiRequest<CreateConversationAssistantSessionResponse>(
    config.whatsappServiceUrl,
    CONVERSATION_ASSISTANT_SESSIONS_PATH,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
  return response.session;
}

export async function getConversationAssistantSession(
  accessToken: string,
  sessionId: string
): Promise<ConversationAssistantSession> {
  const response = await apiRequest<ConversationAssistantSessionResponse>(
    config.whatsappServiceUrl,
    getSessionPath(sessionId),
    accessToken
  );
  return response.session;
}

export async function listConversationAssistantTurns(
  accessToken: string,
  sessionId: string
): Promise<ConversationAssistantTurnsResponse> {
  return await apiRequest<ConversationAssistantTurnsResponse>(
    config.whatsappServiceUrl,
    `${getSessionPath(sessionId)}/turns`,
    accessToken
  );
}

export async function sendConversationAssistantTurn(
  accessToken: string,
  sessionId: string,
  request: SendConversationAssistantTurnRequest
): Promise<ConversationAssistantTurnsResponse> {
  return await apiRequest<ConversationAssistantTurnsResponse>(
    config.whatsappServiceUrl,
    `${getSessionPath(sessionId)}/turns`,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}
