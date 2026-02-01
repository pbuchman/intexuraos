/**
 * Chat types for Intex Chat feature.
 */

/**
 * Message role in conversation.
 */
export type ChatRole = 'user' | 'assistant';

/**
 * Single message in the chat conversation.
 */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
}

/**
 * Source citation for chat response.
 */
export interface ChatSource {
  filePath: string;
  section: string;
}

/**
 * Suggested action from the assistant.
 */
export interface SuggestedAction {
  type: string;
  payload: Record<string, unknown>;
  awaitingConfirmation: boolean;
}

/**
 * Chat response from the backend API.
 */
export interface ChatResponse {
  response: string;
  sources: ChatSource[];
  suggestedAction: SuggestedAction | null;
}

/**
 * Chat session stored in localStorage.
 */
export interface ChatSession {
  messages: ChatMessage[];
  createdAt: number;
  lastActivityAt: number;
}

/**
 * Request payload for sending a chat message.
 */
export interface ChatRequest {
  message: string;
  conversationHistory: ChatMessage[];
  pendingAction?: SuggestedAction;
}
