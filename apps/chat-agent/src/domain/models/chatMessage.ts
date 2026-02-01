/**
 * Chat message representing a single message in the conversation.
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  sources?: DocSource[];
  suggestedAction?: SuggestedAction;
}

/**
 * Source citation for documentation references.
 */
export interface DocSource {
  filePath: string;
  section: string;
}

/**
 * Suggested action that the user can confirm.
 */
export interface SuggestedAction {
  type: 'create_command';
  payload: Record<string, unknown>;
  awaitingConfirmation: boolean;
}

/**
 * Conversation history sent to the chat endpoint.
 */
export interface ConversationHistory {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Chat request body.
 */
export interface ChatRequest {
  message: string;
  conversationHistory: ConversationHistory[];
}

/**
 * Chat response data.
 */
export interface ChatResponse {
  response: string;
  sources: DocSource[];
  suggestedAction: SuggestedAction | null;
}
