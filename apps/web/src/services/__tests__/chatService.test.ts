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
    dataInsightsAgentUrl: 'http://localhost:8119',
    notesAgentUrl: 'http://localhost:8121',
    todosAgentUrl: 'http://localhost:8123',
    bookmarksAgentUrl: 'http://localhost:8124',
    calendarAgentUrl: 'http://localhost:8125',
    linearAgentUrl: 'http://localhost:8126',
    codeAgentUrl: 'http://localhost:8128',
    chatAgentUrl: 'http://localhost:8129',
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

import { sendMessage, saveSession, loadSession, clearSession, CHAT_MESSAGE_TIMEOUT_MS } from '../chatService.js';
import type { ChatMessage, ChatResponse, ChatSession } from '../../types/chat.js';

const LOCAL_STORAGE_KEY = 'intex-chat-session';

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
});
