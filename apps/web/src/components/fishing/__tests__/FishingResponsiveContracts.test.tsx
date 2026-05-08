/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FishingDigestList } from '../FishingDigestList.js';
import { FishingChatPanel } from '../FishingChatPanel.js';
import { FishingKnowledgeTree } from '../FishingKnowledgeTree.js';
import { FishingPageEditor } from '../FishingPageEditor.js';
import type {
  FishingChat,
  FishingChatMessage,
  FishingKnowledgePage,
} from '@/types/fishingAssistant';

describe('Fishing responsive layout contracts', () => {
  it('contains long unbroken assistant markdown inside a shrinkable chat bubble', () => {
    const chat: FishingChat = {
      id: 'chat-1',
      userId: 'user-1',
      title: 'Long assistant response',
      lastMessagePreview: 'Long response',
      lastMessageAt: '2026-05-01T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    const longToken = 'x'.repeat(180);
    const assistantMessage: FishingChatMessage = {
      id: 'message-long',
      chatId: chat.id,
      userId: chat.userId,
      role: 'assistant',
      content: `**${longToken}**\n\n\`${longToken}\``,
      citations: [],
      confidence: 'medium',
      createdAt: '2026-05-01T00:01:00.000Z',
    };
    const onSelectMessage = vi.fn();

    render(
      <MemoryRouter>
        <FishingChatPanel
          chats={[chat]}
          selectedChatId={chat.id}
          messages={[assistantMessage]}
          loading={false}
          sending={false}
          error={null}
          errorCode={null}
          selectedMessageId={assistantMessage.id}
          onSelectChat={vi.fn()}
          onCreateChat={vi.fn()}
          onSendMessage={vi.fn()}
          onSelectMessage={onSelectMessage}
        />
      </MemoryRouter>
    );

    const bubble = screen.getByTestId('fishing-chat-message-message-long');
    expect(bubble).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden');
    expect(bubble).toHaveClass('ring-2', 'ring-blue-500');
    expect(screen.getByTestId('fishing-chat-message-markdown-message-long')).toHaveClass(
      'min-w-0',
      'max-w-full',
      'overflow-x-auto',
      'break-words'
    );

    bubble.click();
    expect(onSelectMessage).toHaveBeenCalledWith(assistantMessage.id);
  });

  it('keeps digest rows stackable on narrow screens', () => {
    render(
      <MemoryRouter>
        <FishingDigestList
          digests={[
            {
              groupKey: 'very-long-fishing-group-key-that-should-not-overflow',
              date: '2026-05-01',
              title: 'Very long digest title that should wrap instead of pushing the badge off screen',
              summaryMarkdown: 'A long digest summary with enough content to verify wrapping behavior.',
              messageCount: 123,
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('fishing-digest-row')).toHaveClass('min-w-0');
    expect(screen.getByTestId('fishing-digest-row-header')).toHaveClass('flex-col', 'sm:flex-row');
    expect(screen.getByTestId('fishing-digest-message-count')).toHaveClass(
      'shrink-0',
      'self-start'
    );
  });

  it('keeps knowledge folder controls usable on narrow screens', () => {
    render(
      <FishingKnowledgeTree
        folders={[
          {
            id: 'folder-1',
            userId: 'user-1',
            name: 'Long folder name that should truncate instead of overflowing',
            parentId: null,
            sortOrder: 0,
            pageCount: 3,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
          },
        ]}
        selectedFolderId="folder-1"
        busy={false}
        onSelectFolder={vi.fn()}
        onCreateFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /create folder/i })).toHaveClass(
      'w-full',
      'sm:w-auto'
    );
    expect(screen.getByTestId('fishing-folder-row-folder-1')).toHaveClass('min-w-0');
  });

  it('keeps the page editor actions and preview responsive', () => {
    const page: FishingKnowledgePage = {
      id: 'page-1',
      userId: 'user-1',
      folderId: 'folder-1',
      title: 'Long knowledge page title',
      rawText: 'raw content',
      normalizedText: 'normalized content',
      contentType: 'notes',
      indexingStatus: 'ready',
      chunkCount: 2,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };

    render(
      <MemoryRouter>
        <FishingPageEditor
          page={page}
          folderName="Folder"
          rawText="raw content"
          saving={false}
          reindexing={false}
          deleting={false}
          error={null}
          onRawTextChange={vi.fn()}
          onSave={vi.fn()}
          onReindex={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('fishing-page-editor-actions')).toHaveClass('w-full', 'sm:w-auto');
    expect(screen.getByTestId('fishing-page-editor-grid')).toHaveClass('min-w-0');
    expect(screen.getByTestId('fishing-page-preview')).toHaveClass('overflow-auto', 'break-words');
  });
});
