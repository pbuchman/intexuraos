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

// ─────────────────────────────────────────────────────────────────────────────
// Chat Panel Size Persistence
// ─────────────────────────────────────────────────────────────────────────────

const PANEL_SIZE_KEY = 'intex-chat-panel-size';

/** Chat panel dimensions */
export interface ChatPanelSize {
  width: number;
  height: number;
}

/**
 * Validate panel size structure.
 */
function isValidPanelSize(data: unknown): data is ChatPanelSize {
  if (typeof data !== 'object' || data === null) return false;
  const size = data as Partial<ChatPanelSize>;
  return typeof size.width === 'number' && typeof size.height === 'number';
}

/**
 * Save chat panel size to localStorage.
 */
export function savePanelSize(size: ChatPanelSize): void {
  try {
    localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(size));
  } catch {
    // Silently fail - localStorage unavailable
  }
}

/**
 * Load chat panel size from localStorage.
 */
export function loadPanelSize(): ChatPanelSize | null {
  try {
    const stored = localStorage.getItem(PANEL_SIZE_KEY);
    if (stored === null) return null;

    const parsed: unknown = JSON.parse(stored);
    return isValidPanelSize(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
