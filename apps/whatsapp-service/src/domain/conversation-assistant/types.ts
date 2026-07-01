import type { GenerateChatResult } from '@intexuraos/llm-factory';
import type {
  PrivateConversationContextOmittedCounts,
  PrivateConversationContextResponse,
} from '../whatsapp/models/PrivateWhatsApp.js';

export type ConversationAssistantSessionStatus = 'active' | 'archived';
export type ConversationAssistantTurnRole = 'user' | 'assistant';

export interface ConversationAssistantSession {
  id: string;
  userId: string;
  chatId: string;
  chatDisplayName?: string;
  status: ConversationAssistantSessionStatus;
  range: { from: string; to: string };
  model: string;
  transcriptSha256: string;
  transcriptMessageCount: number;
  transcriptText: string;
  omitted: PrivateConversationContextOmittedCounts;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastTurnAt?: string;
}

export type PublicConversationAssistantSession = Omit<
  ConversationAssistantSession,
  'transcriptText'
>;

export interface ConversationAssistantTurn {
  id: string;
  sessionId: string;
  userId: string;
  role: ConversationAssistantTurnRole;
  text: string;
  createdAt: string;
  usage?: GenerateChatResult['usage'];
  error?: { code: string; message: string };
}

export interface CreateConversationAssistantSessionInput {
  userId: string;
  chatId: string;
  from: string;
  to: string;
  maxMessages?: number;
  question?: string;
}

export interface CheckConversationAssistantContextInput {
  userId: string;
  chatId: string;
  from: string;
  to: string;
}

export interface CheckConversationAssistantContextResult {
  messageCount: number;
  warningThreshold: number;
  requiresConfirmation: boolean;
}

export interface SendConversationAssistantTurnInput {
  userId: string;
  sessionId: string;
  question: string;
}

export interface CreateConversationAssistantSessionResult {
  session: ConversationAssistantSession;
  turns: ConversationAssistantTurn[];
  context: PrivateConversationContextResponse;
}

export interface ConversationAssistantError {
  code:
    | 'INVALID_REQUEST'
    | 'NOT_FOUND'
    | 'EMPTY_TRANSCRIPT'
    | 'LLM_ERROR'
    | 'PERSISTENCE_ERROR'
    | 'INTERNAL_ERROR';
  message: string;
}

export type ConversationAssistantResult<T> = import('@intexuraos/common-core').Result<
  T,
  ConversationAssistantError
>;

export type ConversationAssistantStreamEvent =
  | { type: 'user_turn'; turn: ConversationAssistantTurn }
  | { type: 'assistant_delta'; text: string }
  | { type: 'usage'; usage: GenerateChatResult['usage'] }
  | { type: 'error'; error: ConversationAssistantError }
  | { type: 'assistant_turn'; turn: ConversationAssistantTurn }
  | { type: 'done' };

export const CONVERSATION_ASSISTANT_LARGE_CONTEXT_WARNING_THRESHOLD = 5000;
