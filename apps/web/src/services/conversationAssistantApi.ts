import { config } from '@/config';
import type {
  ConversationAssistantSession,
  ConversationAssistantSessionsResponse,
  ConversationAssistantTurnsResponse,
  CreateConversationAssistantSessionRequest,
  SendConversationAssistantTurnRequest,
} from '@/types';
import { apiRequest } from './apiClient.js';

const CONVERSATION_ASSISTANT_SESSIONS_PATH = '/conversation-assistant/sessions';

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
  return await apiRequest<ConversationAssistantSession>(
    config.whatsappServiceUrl,
    CONVERSATION_ASSISTANT_SESSIONS_PATH,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function getConversationAssistantSession(
  accessToken: string,
  sessionId: string
): Promise<ConversationAssistantSession> {
  return await apiRequest<ConversationAssistantSession>(
    config.whatsappServiceUrl,
    getSessionPath(sessionId),
    accessToken
  );
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
