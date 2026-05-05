/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FishingChatPanel } from '../FishingChatPanel.js';
import type { FishingChat, FishingChatMessage } from '@/types/fishingAssistant';

const chats: FishingChat[] = [
  {
    id: 'chat-1',
    userId: 'user-1',
    title: 'Spring bait',
    lastMessagePreview: 'Use pinka',
    lastMessageAt: '2026-05-05T10:00:00.000Z',
    createdAt: '2026-05-05T09:00:00.000Z',
    updatedAt: '2026-05-05T10:00:00.000Z',
  },
];

const messages: FishingChatMessage[] = [
  {
    id: 'message-1',
    chatId: 'chat-1',
    userId: 'user-1',
    role: 'user',
    content: 'What bait now?',
    citations: [],
    createdAt: '2026-05-05T10:00:00.000Z',
  },
  {
    id: 'message-2',
    chatId: 'chat-1',
    userId: 'user-1',
    role: 'assistant',
    content: '**Use pinka** with light groundbait.',
    citations: [
      {
        sourceId: 'chunk-1',
        sourceType: 'knowledge_page',
        title: 'Spring Bait',
        quote: 'Use pinka with light groundbait.',
        usedFor: 'Groundbait recommendation',
        url: '/fishing-assistant/knowledge/pages/page-1',
      },
    ],
    confidence: 'high',
    createdAt: '2026-05-05T10:01:00.000Z',
  },
];

describe('FishingChatPanel', () => {
  it('opens chats, starts a new chat, and sends messages', async () => {
    const onSelectChat = vi.fn();
    const onCreateChat = vi.fn();
    const onSendMessage = vi.fn().mockResolvedValue({
      chat: chats[0],
      message: messages[1],
    });

    render(
      <MemoryRouter>
        <FishingChatPanel
          chats={chats}
          selectedChatId="chat-1"
          messages={messages}
          loading={false}
          sending={false}
          error={null}
          errorCode={null}
          onSelectChat={onSelectChat}
          onCreateChat={onCreateChat}
          onSendMessage={onSendMessage}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /spring bait/i }));
    fireEvent.click(screen.getByRole('button', { name: /new chat/i }));
    fireEvent.change(screen.getByLabelText(/ask fishing assistant/i), {
      target: { value: 'Use pinka?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith('Use pinka?');
    });
    expect(onSelectChat).toHaveBeenCalledWith('chat-1');
    expect(onCreateChat).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Use pinka', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '[1]' })).toHaveAttribute(
      'href',
      '/fishing-assistant/knowledge/pages/page-1'
    );
  });

  it('prevents default on Enter and leaves Shift+Enter alone', async () => {
    const onSendMessage = vi.fn().mockResolvedValue(null);

    render(
      <MemoryRouter>
        <FishingChatPanel
          chats={chats}
          selectedChatId="chat-1"
          messages={messages}
          loading={false}
          sending={false}
          error={null}
          errorCode={null}
          onSelectChat={vi.fn()}
          onCreateChat={vi.fn()}
          onSendMessage={onSendMessage}
        />
      </MemoryRouter>
    );

    const input = screen.getByLabelText(/ask fishing assistant/i);

    fireEvent.change(input, { target: { value: 'Line one' } });
    expect(
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', cancelable: true })
    ).toBe(false);
    expect(
      fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        shiftKey: true,
        cancelable: true,
      })
    ).toBe(true);
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('links the missing OpenRouter key state to API key settings', () => {
    render(
      <MemoryRouter>
        <FishingChatPanel
          chats={[]}
          selectedChatId={undefined}
          messages={[]}
          loading={false}
          sending={false}
          error="OpenRouter API key is required for Fishing Assistant chat."
          errorCode="NO_API_KEY"
          onSelectChat={vi.fn()}
          onCreateChat={vi.fn()}
          onSendMessage={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/openrouter api key is required/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add openrouter key/i })).toHaveAttribute(
      'href',
      '/settings/api-keys'
    );
  });
});
