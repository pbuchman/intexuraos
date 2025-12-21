/**
 * Tests for NotionInboxNotesRepository.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotionInboxNotesRepository } from '../inboxNotesRepository.js';
import type { InboxNote } from '@praxos/domain-inbox';

// Mock the Notion client
vi.mock('@notionhq/client', () => {
  return {
    Client: vi.fn(),
  };
});

import { Client } from '@notionhq/client';

describe('NotionInboxNotesRepository', () => {
  let repo: NotionInboxNotesRepository;
  let mockClient: {
    pages: {
      create: ReturnType<typeof vi.fn>;
      retrieve: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  const testConfig = {
    token: 'test-token',
    databaseId: 'test-db-id',
  };

  const sampleNote: InboxNote = {
    title: 'Test Note',
    status: 'Inbox',
    source: 'WhatsApp',
    messageType: 'Text',
    contentType: 'Other',
    topics: [],
    originalText: 'Test message',
    capturedAt: '2024-01-01T00:00:00.000Z',
    sender: 'Test User (+1234567890)',
    externalId: 'msg-123',
    processedBy: 'None',
  };

  beforeEach((): void => {
    mockClient = {
      pages: {
        create: vi.fn(),
        retrieve: vi.fn(),
        update: vi.fn(),
      },
    };

    vi.mocked(Client).mockImplementation(() => mockClient as never);
    repo = new NotionInboxNotesRepository(testConfig);
  });

  describe('createNote', () => {
    it('creates note in Notion successfully', async (): Promise<void> => {
      mockClient.pages.create.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
      });

      const result = await repo.createNote(sampleNote);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('notion-page-id');
        expect(result.value.title).toBe('Test Note');
      }

      expect(mockClient.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'test-db-id' },
          properties: expect.any(Object),
        })
      );
    });

    it('maps note properties correctly', async (): Promise<void> => {
      mockClient.pages.create.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
      });

      await repo.createNote(sampleNote);

      const createCall = mockClient.pages.create.mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        const properties = createCall.properties;

        expect(properties).toHaveProperty('Title');
        expect(properties).toHaveProperty('Status');
        expect(properties).toHaveProperty('Source');
        expect(properties).toHaveProperty('Message type');
      }
    });

    it('returns error when Notion API fails', async (): Promise<void> => {
      mockClient.pages.create.mockRejectedValue(new Error('Notion API error'));

      const result = await repo.createNote(sampleNote);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to create inbox note in Notion');
      }
    });

    it('handles note with all optional fields', async (): Promise<void> => {
      mockClient.pages.create.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
      });

      const fullNote: InboxNote = {
        ...sampleNote,
        id: 'existing-id',
        cleanText: 'Cleaned text',
        transcript: 'Audio transcript',
        mediaFiles: ['file1.jpg', 'file2.mp4'],
        processingRunId: 'run-123',
        errors: 'Some error',
        url: 'https://example.com',
        actionIds: ['action-1', 'action-2'],
      };

      const result = await repo.createNote(fullNote);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('notion-page-id');
      }
    });
  });

  describe('getNote', () => {
    it.skip('retrieves note from Notion successfully', async () => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
        properties: {
          Title: {
            title: [{ plain_text: 'Test Note' }],
          },
          Status: {
            status: { name: 'Inbox' },
          },
          Source: {
            select: { name: 'WhatsApp' },
          },
          'Message type': {
            select: { name: 'Text' },
          },
          Type: {
            select: { name: 'Other' },
          },
          Topics: {
            multi_select: [],
          },
          'Original text': {
            rich_text: [{ plain_text: 'Test message' }],
          },
          'Captured at': {
            date: { start: '2024-01-01T00:00:00.000Z' },
          },
          Sender: {
            rich_text: [{ plain_text: 'Test User (+1234567890)' }],
          },
          'External ID': {
            rich_text: [{ plain_text: 'msg-123' }],
          },
          'Processed by': {
            select: { name: 'None' },
          },
        },
      });

      const result = await repo.getNote('notion-page-id');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== undefined) {
        expect(result.value.id).toBe('notion-page-id');
        expect(result.value.title).toBe('Test Note');
        expect(result.value.status).toBe('Inbox');
        expect(result.value.source).toBe('WhatsApp');
      }
    });

    it('returns null when page has no properties', async (): Promise<void> => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
      });

      const result = await repo.getNote('notion-page-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when Notion API fails', async (): Promise<void> => {
      mockClient.pages.retrieve.mockRejectedValue(new Error('Notion API error'));

      const result = await repo.getNote('notion-page-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to get inbox note from Notion');
      }
    });
  });

  describe('updateNote', () => {
    it.skip('updates note in Notion successfully', async () => {
      mockClient.pages.update.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
        properties: {
          Title: {
            title: [{ plain_text: 'Updated Note' }],
          },
          Status: {
            status: { name: 'Processing' },
          },
          Source: {
            select: { name: 'WhatsApp' },
          },
          'Message type': {
            select: { name: 'Text' },
          },
          Type: {
            select: { name: 'Other' },
          },
          Topics: {
            multi_select: [],
          },
          'Original text': {
            rich_text: [{ plain_text: 'Test message' }],
          },
          'Captured at': {
            date: { start: '2024-01-01T00:00:00.000Z' },
          },
          Sender: {
            rich_text: [{ plain_text: 'Test User' }],
          },
          'External ID': {
            rich_text: [{ plain_text: 'msg-123' }],
          },
          'Processed by': {
            select: { name: 'None' },
          },
        },
      });

      const updates: Partial<InboxNote> = {
        status: 'Processing',
        title: 'Updated Note',
      };

      const result = await repo.updateNote('notion-page-id', updates);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('notion-page-id');
        expect(result.value.status).toBe('Processing');
      }

      expect(mockClient.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: 'notion-page-id',
          properties: expect.any(Object),
        })
      );
    });

    it('returns error when response has no properties', async (): Promise<void> => {
      mockClient.pages.update.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
      });

      const result = await repo.updateNote('notion-page-id', { status: 'Processing' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Failed to update inbox note');
      }
    });

    it('returns error when Notion API fails', async (): Promise<void> => {
      mockClient.pages.update.mockRejectedValue(new Error('Notion API error'));

      const result = await repo.updateNote('notion-page-id', { status: 'Processing' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to update inbox note in Notion');
      }
    });
  });
});
