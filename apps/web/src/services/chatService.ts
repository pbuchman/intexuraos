/**
 * Chat service for Intex Chat feature.
 * Handles API communication and localStorage session persistence.
 * Supports both authenticated users and guest sessions.
 */

import { config } from '../config.js';
import { apiRequest, ApiError } from './apiClient.js';
import type {
  ChatMessage,
  ChatResponse,
  ChatSession,
  SuggestedAction,
} from '../types/chat.js';

const LOCAL_STORAGE_KEY = 'intex-chat-session';
const GUEST_SESSION_KEY = 'intex-guest-session-token';
const GUEST_SESSION_EXPIRES_KEY = 'intex-guest-session-expires';
const LEGACY_GUEST_SESSION_KEY = 'intex-guest-session-id';

/** Timeout for chat message requests — longer than default to handle Cloud Run cold starts. */
export const CHAT_MESSAGE_TIMEOUT_MS = 60000;

// Re-export ApiError for consumers
export { ApiError };

// Purge legacy unsigned guest session ID from localStorage on module import.
// Wrapped in try/catch to handle SSR/incognito environments without localStorage.
try {
  localStorage.removeItem(LEGACY_GUEST_SESSION_KEY);
} catch {
  // localStorage unavailable
}

/**
 * Get or create a signed guest session token for anonymous users.
 *
 * The token is fetched from the chat-agent's `/guest-session` endpoint and
 * cached in localStorage along with its expiry timestamp. A 30-second buffer
 * is applied to the expiry check to avoid using a token that is about to
 * expire mid-flight.
 */
export async function getOrCreateGuestSessionToken(): Promise<string> {
  // Try cache first
  try {
    const cachedToken = localStorage.getItem(GUEST_SESSION_KEY);
    const cachedExpiresRaw = localStorage.getItem(GUEST_SESSION_EXPIRES_KEY);
    if (cachedToken !== null && cachedExpiresRaw !== null) {
      const cachedExpires = Number(cachedExpiresRaw);
      if (
        Number.isFinite(cachedExpires) &&
        cachedExpires > Date.now() + 30_000
      ) {
        return cachedToken;
      }
    }
  } catch {
    // localStorage unavailable - fall through to fetch
  }

  const url = `${config.chatAgentUrl}/guest-session`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError('UNKNOWN', 'Invalid response format', response.status);
  }

  if (
    typeof json !== 'object' ||
    json === null ||
    !('success' in json)
  ) {
    throw new ApiError('UNKNOWN', 'Invalid response format', response.status);
  }

  const data = json as {
    success: boolean;
    data?: { sessionToken: string; expiresAt: number };
    error?: { code: string; message: string };
  };

  if (!data.success) {
    const error = data.error;
    if (error === undefined) {
      throw new ApiError('UNKNOWN', 'An unexpected error occurred', response.status);
    }
    throw new ApiError(error.code, error.message, response.status);
  }

  if (
    data.data === undefined ||
    typeof data.data.sessionToken !== 'string' ||
    typeof data.data.expiresAt !== 'number'
  ) {
    throw new ApiError('UNKNOWN', 'Missing response data', response.status);
  }

  const { sessionToken, expiresAt } = data.data;

  try {
    localStorage.setItem(GUEST_SESSION_KEY, sessionToken);
    localStorage.setItem(GUEST_SESSION_EXPIRES_KEY, String(expiresAt));
  } catch {
    // localStorage unavailable - return token without caching
  }

  return sessionToken;
}

/**
 * Send a message to the chat agent as an authenticated user.
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
    '/',
    accessToken,
    {
      method: 'POST',
      body: {
        message,
        conversationHistory,
        ...(pendingAction !== undefined && { pendingAction }),
      },
      timeout: CHAT_MESSAGE_TIMEOUT_MS,
    }
  );
}

/**
 * Send a message to the chat agent as a guest (unauthenticated).
 * Uses a server-signed JWT session token (fetched from `/guest-session`)
 * stored in localStorage for verified, abuse-resistant rate limiting.
 *
 * @param message - User message to send
 * @param conversationHistory - Previous messages in the conversation
 * @param pendingAction - Optional pending action to confirm
 * @returns The chat response with answer, sources, and suggested action
 */
export async function sendGuestMessage(
  message: string,
  conversationHistory: ChatMessage[],
  pendingAction?: SuggestedAction
): Promise<ChatResponse> {
  const guestSessionToken = await getOrCreateGuestSessionToken();
  const url = `${config.chatAgentUrl}/`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Guest-Session': guestSessionToken,
    },
    body: JSON.stringify({
      message,
      conversationHistory,
      ...(pendingAction !== undefined && { pendingAction }),
    }),
  });

  const json: unknown = await response.json();

  if (
    typeof json !== 'object' ||
    json === null ||
    !('success' in json)
  ) {
    throw new ApiError('UNKNOWN', 'Invalid response format', response.status);
  }

  const data = json as { success: boolean; data?: ChatResponse; error?: { code: string; message: string } };

  if (!data.success) {
    const error = data.error;
    if (error === undefined) {
      throw new ApiError('UNKNOWN', 'An unexpected error occurred', response.status);
    }
    throw new ApiError(error.code, error.message, response.status);
  }

  if (data.data === undefined) {
    throw new ApiError('UNKNOWN', 'Missing response data', response.status);
  }

  return data.data;
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
