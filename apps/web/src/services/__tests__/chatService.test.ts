/**
 * Tests for chatService.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock apiClient - MUST come before imports that trigger apiClient load
const mockApiRequest = vi.fn();
vi.mock('../apiClient.js', () => ({
  apiRequest: (...args: unknown[]): unknown => mockApiRequest(...args),
  ApiError: class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
      public details?: Record<string, unknown>
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

// Mock config module - must use factory because config runs at load time
// Path is ../../config because test is in services/__tests__/
// The config export should match AppConfig interface shape
vi.mock('../../config', () => {
  const mockConfig = {
    auth0Domain: 'test-domain',
    auth0ClientId: 'test-client-id',
    authAudience: 'test-audience',
    authServiceUrl: 'http://localhost:8110',
    whatsappServiceUrl: 'http://localhost:8113',
    notionServiceUrl: 'http://localhost:8112',
    mobileNotificationsServiceUrl: 'http://localhost:8114',
    ResearchAgentUrl: 'http://localhost:8116',
    commandsAgentServiceUrl: 'http://localhost:8117',
    actionsAgentUrl: 'http://localhost:8118',
    notesAgentUrl: 'http://localhost:8121',
    todosAgentUrl: 'http://localhost:8123',
    bookmarksAgentUrl: 'http://localhost:8124',
    calendarAgentUrl: 'http://localhost:8125',
    linearAgentUrl: 'http://localhost:8126',
    codeAgentUrl: 'http://localhost:8128',
    chatAgentUrl: 'http://localhost:8129',
    hellscriptAgentUrl: 'http://localhost:8130',
    appSettingsServiceUrl: 'http://localhost:8122',
    firebaseProjectId: 'test-project',
    firebaseApiKey: 'test-key',
    firebaseAuthDomain: 'test.firebaseapp.com',
    sentryDsn: 'test-dsn',
  };
  return {
    config: mockConfig,
    getConfig: (): typeof mockConfig => mockConfig,
  };
});

import {
  sendMessage,
  sendGuestMessage,
  getOrCreateGuestSessionToken,
  saveSession,
  loadSession,
  clearSession,
  CHAT_MESSAGE_TIMEOUT_MS,
} from '../chatService.js';
import type { ChatMessage, ChatResponse, ChatSession } from '../../types/chat.js';

const LOCAL_STORAGE_KEY = 'intex-chat-session';
const GUEST_SESSION_KEY = 'intex-guest-session-token';
const GUEST_SESSION_EXPIRES_KEY = 'intex-guest-session-expires';
const LEGACY_GUEST_SESSION_KEY = 'intex-guest-session-id';

// Mock localStorage with proper methods
const mockLocalStorage = {
  store: new Map<string, string>(),
  clear(): void {
    this.store.clear();
  },
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  },
  removeItem(key: string): void {
    this.store.delete(key);
  },
  get length(): number {
    return this.store.size;
  },
  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  },
};

// Setup global localStorage
Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

describe('chatService', () => {
  const mockAccessToken = 'test-access-token';

  const mockResponse: ChatResponse = {
    response: 'Here is your answer',
    sources: [
      { filePath: '/docs/example.md', section: 'Introduction' },
    ],
    suggestedAction: null,
  };

  const mockMessages: ChatMessage[] = [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content: 'Hi there!',
      timestamp: Date.now() + 1000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('sendMessage', () => {
    it('calls the API with auth token', async () => {
      mockApiRequest.mockResolvedValue(mockResponse);

      const result = await sendMessage(mockAccessToken, 'Test message', []);

      expect(mockApiRequest).toHaveBeenCalledWith(
        'http://localhost:8129',
        '/chat',
        mockAccessToken,
        {
          method: 'POST',
          body: {
            message: 'Test message',
            conversationHistory: [],
          },
          timeout: CHAT_MESSAGE_TIMEOUT_MS,
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('includes conversation history in API call', async () => {
      mockApiRequest.mockResolvedValue(mockResponse);

      await sendMessage(mockAccessToken, 'New message', mockMessages);

      expect(mockApiRequest).toHaveBeenCalledWith(
        'http://localhost:8129',
        '/chat',
        mockAccessToken,
        {
          method: 'POST',
          body: {
            message: 'New message',
            conversationHistory: mockMessages,
          },
          timeout: CHAT_MESSAGE_TIMEOUT_MS,
        }
      );
    });

    it('includes pending action in API call when provided', async () => {
      mockApiRequest.mockResolvedValue(mockResponse);

      const pendingAction = {
        type: 'create_command',
        payload: { text: 'test command' },
        awaitingConfirmation: true,
      };

      await sendMessage(mockAccessToken, 'Confirm', [], pendingAction);

      expect(mockApiRequest).toHaveBeenCalledWith(
        'http://localhost:8129',
        '/chat',
        mockAccessToken,
        {
          method: 'POST',
          body: {
            message: 'Confirm',
            conversationHistory: [],
            pendingAction,
          },
          timeout: CHAT_MESSAGE_TIMEOUT_MS,
        }
      );
    });

    it('throws ApiError on API failure', async () => {
      const { ApiError } = await import('../apiClient.js');
      mockApiRequest.mockRejectedValue(
        new ApiError('DOWNSTREAM_ERROR', 'Service unavailable', 503)
      );

      await expect(
        sendMessage(mockAccessToken, 'Test', [])
      ).rejects.toThrow(ApiError);
    });
  });

  describe('saveSession', () => {
    it('stores session to localStorage', () => {
      const session: ChatSession = {
        messages: mockMessages,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      };

      saveSession(session);

      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored ?? '')).toEqual(session);
    });

    it('overwrites existing session', () => {
      const session1: ChatSession = {
        messages: [{ id: '1', role: 'user', content: 'First', timestamp: 1 }],
        createdAt: 1,
        lastActivityAt: 1,
      };

      const session2: ChatSession = {
        messages: [{ id: '2', role: 'user', content: 'Second', timestamp: 2 }],
        createdAt: 2,
        lastActivityAt: 2,
      };

      saveSession(session1);
      saveSession(session2);

      const stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? '');
      expect(stored.messages[0].content).toBe('Second');
    });
  });

  describe('loadSession', () => {
    it('restores session from localStorage', () => {
      const session: ChatSession = {
        messages: mockMessages,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      };

      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));

      const loaded = loadSession();

      expect(loaded).toEqual(session);
    });

    it('returns null when no session exists', () => {
      const loaded = loadSession();

      expect(loaded).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      localStorage.setItem(LOCAL_STORAGE_KEY, 'invalid-json{');

      const loaded = loadSession();

      expect(loaded).toBeNull();
    });

    it('returns null for invalid session structure', () => {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
        messages: 'not-an-array',
        createdAt: 'not-a-number',
        lastActivityAt: 'not-a-number',
      }));

      const loaded = loadSession();

      expect(loaded).toBeNull();
    });
  });

  describe('clearSession', () => {
    it('removes session from localStorage', () => {
      const session: ChatSession = {
        messages: mockMessages,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      };

      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(session));
      expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeTruthy();

      clearSession();

      expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeNull();
    });

    it('does nothing when no session exists', () => {
      expect(() => clearSession()).not.toThrow();
    });
  });

  describe('getOrCreateGuestSessionToken', () => {
    /** Create a minimal fetch Response mock compatible with jsdom. */
    function mockFetchResponse(body: unknown, status: number): Response {
      return {
        status,
        ok: status >= 200 && status < 300,
        json: () => Promise.resolve(body),
      } as unknown as Response;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('fetches a fresh token from /guest-session and caches it', async () => {
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(
          { success: true, data: { sessionToken: 'jwt.token.here', expiresAt } },
          200
        )
      );

      const token = await getOrCreateGuestSessionToken();

      expect(token).toBe('jwt.token.here');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8129/guest-session',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('jwt.token.here');
      expect(localStorage.getItem(GUEST_SESSION_EXPIRES_KEY)).toBe(String(expiresAt));
    });

    it('returns the cached token on a second call without fetching again', async () => {
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(
          { success: true, data: { sessionToken: 'jwt.token.cached', expiresAt } },
          200
        )
      );

      const first = await getOrCreateGuestSessionToken();
      const second = await getOrCreateGuestSessionToken();

      expect(first).toBe('jwt.token.cached');
      expect(second).toBe('jwt.token.cached');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('refetches when cached token has expired (within 30s buffer)', async () => {
      // Pre-populate cache with a token expiring in 10s — within 30s buffer
      localStorage.setItem(GUEST_SESSION_KEY, 'expired.jwt');
      localStorage.setItem(GUEST_SESSION_EXPIRES_KEY, String(Date.now() + 10_000));

      const newExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(
          { success: true, data: { sessionToken: 'fresh.jwt', expiresAt: newExpiresAt } },
          200
        )
      );

      const token = await getOrCreateGuestSessionToken();

      expect(token).toBe('fresh.jwt');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(GUEST_SESSION_KEY)).toBe('fresh.jwt');
    });

    it('throws ApiError when response is not the success envelope', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({ unexpected: 'shape' }, 500)
      );

      const { ApiError } = await import('../apiClient.js');
      await expect(getOrCreateGuestSessionToken()).rejects.toThrow(ApiError);
    });

    it('throws ApiError with backend code when success=false', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(
          { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
          429
        )
      );

      const { ApiError } = await import('../apiClient.js');
      try {
        await getOrCreateGuestSessionToken();
        expect.fail('expected ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as InstanceType<typeof ApiError>;
        expect(apiErr.code).toBe('RATE_LIMITED');
        expect(apiErr.message).toBe('Too many requests');
        expect(apiErr.status).toBe(429);
      }
    });

    it('throws ApiError when success=true but data is missing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({ success: true }, 200)
      );

      const { ApiError } = await import('../apiClient.js');
      await expect(getOrCreateGuestSessionToken()).rejects.toThrow(ApiError);
    });
  });

  describe('sendGuestMessage', () => {
    /** Create a minimal fetch Response mock compatible with jsdom. */
    function mockFetchResponse(body: unknown, status: number): Response {
      return {
        status,
        ok: status >= 200 && status < 300,
        json: () => Promise.resolve(body),
      } as unknown as Response;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('fetches a guest token then sends the chat message with X-Guest-Session header', async () => {
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          mockFetchResponse(
            { success: true, data: { sessionToken: 'guest.jwt', expiresAt } },
            200
          )
        )
        .mockResolvedValueOnce(
          mockFetchResponse({ success: true, data: mockResponse }, 200)
        );

      const result = await sendGuestMessage('Hello there', []);

      expect(result).toEqual(mockResponse);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const sessionCall = fetchSpy.mock.calls[0];
      expect(sessionCall?.[0]).toBe('http://localhost:8129/guest-session');

      const chatCall = fetchSpy.mock.calls[1];
      expect(chatCall?.[0]).toBe('http://localhost:8129/chat');
      const chatInit = chatCall?.[1] as RequestInit;
      const headers = chatInit.headers as Record<string, string>;
      expect(headers['X-Guest-Session']).toBe('guest.jwt');
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('legacy guest session key purge', () => {
    it('removes the legacy intex-guest-session-id key on module import', async () => {
      // The module has already been imported at the top of this file, so the
      // purge has already run on initial load. To verify the behavior, we
      // re-import after seeding the legacy key, using vi.resetModules.
      localStorage.setItem(LEGACY_GUEST_SESSION_KEY, 'old-uuid');

      vi.resetModules();
      await import('../chatService.js');

      expect(localStorage.getItem(LEGACY_GUEST_SESSION_KEY)).toBeNull();
    });
  });
});
