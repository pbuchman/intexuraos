import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationAssistantSession,
  getConversationAssistantSession,
  listConversationAssistantSessions,
  listConversationAssistantTurns,
  sendConversationAssistantTurn,
} from '../conversationAssistantApi.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    whatsappServiceUrl: 'https://wa.test',
  },
}));

const TOKEN = 'access-token';

describe('conversationAssistantApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists conversation assistant sessions from the WhatsApp service base URL', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ sessions: [] });

    await listConversationAssistantSessions(TOKEN);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions',
      TOKEN
    );
  });

  it('creates a conversation assistant session with a POST body', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ id: 'session-1' });

    const request = {
      chatId: 'chat-1',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-02T00:00:00.000Z',
      question: 'What happened?',
    };

    await createConversationAssistantSession(TOKEN, request);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions',
      TOKEN,
      {
        method: 'POST',
        body: request,
      }
    );
  });

  it('loads a single conversation assistant session with URL-encoded session ids', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ id: 'session/with spaces?' });

    await getConversationAssistantSession(TOKEN, 'session/with spaces?');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces%3F',
      TOKEN
    );
  });

  it('lists conversation assistant turns with URL-encoded session ids', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ turns: [] });

    await listConversationAssistantTurns(TOKEN, 'session/with spaces?');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces%3F/turns',
      TOKEN
    );
  });

  it('sends a conversation assistant turn with a POST body and URL-encoded session id', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ turns: [{ id: 'turn-1' }] });

    const request = {
      question: 'Summarize the disagreement.',
    };

    await sendConversationAssistantTurn(TOKEN, 'session/with spaces?', request);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces%3F/turns',
      TOKEN,
      {
        method: 'POST',
        body: request,
      }
    );
  });
});
