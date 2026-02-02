/**
 * Chat service for Intex Chat feature.
 * Handles API communication and localStorage session persistence.
 */

import { config } from '../config.js';
import { apiRequest } from './apiClient.js';
import type {
  ChatMessage,
  ChatResponse,
  ChatSession,
  SuggestedAction,
} from '../types/chat';

const LOCAL_STORAGE_KEY = 'intex-chat-session';

/**
 * Send a message to the chat agent and get a response.
 *
 * @param accessToken - Auth token for API request
 * @param message - User message to send
 * @param conversationHistory - Previous messages in the conversation
 * @param pendingAction - Optional pending action to confirm
 * @returns The chat response with answer, sources, and suggested action
 */
export async function sendMessage(
  accessToken: string,
  message: string,
  conversationHistory: ChatMessage[],
  pendingAction?: SuggestedAction
): Promise<ChatResponse> {
  return await apiRequest<ChatResponse>(
    config.chatAgentUrl,
    '/chat',
    accessToken,
    {
      method: 'POST',
      body: {
        message,
        conversationHistory,
        ...(pendingAction !== undefined && { pendingAction }),
      },
    }
  );
}

/**
 * Validate session structure.
 */
function isValidSession(data: unknown): data is ChatSession {
  if (typeof data !== 'object' || data === null) return false;

  const session = data as Partial<ChatSession>;

  return (
    Array.isArray(session.messages) &&
    typeof session.createdAt === 'number' &&
    typeof session.lastActivityAt === 'number' &&
    session.messages.every(
      (msg): msg is ChatMessage => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime validation for localStorage data
        if (typeof msg !== 'object' || msg === null) return false;
        const m = msg as Partial<ChatMessage>;
        return (
          typeof m.id === 'string' &&
          typeof m.content === 'string' &&
          typeof m.timestamp === 'number' &&
          (m.role === 'user' || m.role === 'assistant')
        );
      }
    )
  );
}

/**
 * Save chat session to localStorage.
 *
 * @param session - The session to save
 */
export function saveSession(session: ChatSession): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Silently fail - localStorage unavailable in incognito/private browsing
  }
}

/**
 * Load chat session from localStorage.
 *
 * @returns The saved session or null if none exists or is invalid
 */
export function loadSession(): ChatSession | null {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored === null) return null;

    const parsed = JSON.parse(stored);
    return isValidSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Clear chat session from localStorage.
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // Silently fail - localStorage unavailable
  }
}
