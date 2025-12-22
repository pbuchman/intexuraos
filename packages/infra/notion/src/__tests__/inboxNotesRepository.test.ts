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
          properties: expect.any(Object) as object,
        })
      );
    });

    it('maps note properties correctly', async (): Promise<void> => {
      mockClient.pages.create.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
      } as never);

      await repo.createNote(sampleNote);

      const createCall = mockClient.pages.create.mock.calls[0]?.[0] as
        | { properties: Record<string, unknown> }
        | undefined;
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
      if (result.ok) {
        expect(result.value).not.toBeNull();
        if (result.value !== null) {
          expect(result.value.id).toBe('notion-page-id');
          expect(result.value.title).toBe('Test Note');
          expect(result.value.status).toBe('Inbox');
          expect(result.value.source).toBe('WhatsApp');
        }
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
          properties: expect.any(Object) as object,
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

  describe('property mapping', () => {
    it('maps all optional properties correctly', async (): Promise<void> => {
      mockClient.pages.create.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
      });

      const fullNote: InboxNote = {
        title: 'Full Test Note',
        status: 'Processing',
        source: 'WhatsApp',
        messageType: 'Text',
        contentType: 'Task',
        topics: ['AI', 'Work'],
        originalText: 'Original text content',
        cleanText: 'Clean text content',
        transcript: 'Audio transcript',
        capturedAt: '2024-01-01T00:00:00.000Z',
        sender: 'Test User',
        externalId: 'ext-123',
        processingRunId: 'run-456',
        processedBy: 'MasterNotesAssistant',
        errors: 'Some error message',
        url: 'https://example.com/note',
      };

      await repo.createNote(fullNote);

      const createCall = mockClient.pages.create.mock.calls[0]?.[0] as
        | { properties: Record<string, unknown> }
        | undefined;
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        const properties = createCall.properties;

        expect(properties).toHaveProperty('Title');
        expect(properties).toHaveProperty('Status');
        expect(properties).toHaveProperty('Source');
        expect(properties).toHaveProperty('Message type');
        expect(properties).toHaveProperty('Type');
        expect(properties).toHaveProperty('Topic');
        expect(properties).toHaveProperty('Original text');
        expect(properties).toHaveProperty('Clean text');
        expect(properties).toHaveProperty('Transcript');
        expect(properties).toHaveProperty('Captured at');
        expect(properties).toHaveProperty('Sender');
        expect(properties).toHaveProperty('External ID');
        expect(properties).toHaveProperty('Processing run id');
        expect(properties).toHaveProperty('Processed by');
        expect(properties).toHaveProperty('Errors');
        expect(properties).toHaveProperty('URL');
      }
    });

    it('does not include undefined optional properties', async (): Promise<void> => {
      mockClient.pages.create.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
      });

      const minimalNote: InboxNote = {
        title: 'Minimal Note',
        status: 'Inbox',
        source: 'WhatsApp',
        messageType: 'Text',
        contentType: 'Other',
        topics: [],
        originalText: 'Text',
        capturedAt: '2024-01-01T00:00:00.000Z',
        sender: 'Sender',
        externalId: 'ext-1',
        processedBy: 'None',
      };

      await repo.createNote(minimalNote);

      const createCall = mockClient.pages.create.mock.calls[0]?.[0] as
        | { properties: Record<string, unknown> }
        | undefined;
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        const properties = createCall.properties;

        expect(properties).not.toHaveProperty('Clean text');
        expect(properties).not.toHaveProperty('Transcript');
        expect(properties).not.toHaveProperty('Processing run id');
        expect(properties).not.toHaveProperty('Errors');
        expect(properties).not.toHaveProperty('URL');
        expect(properties).not.toHaveProperty('Topic');
      }
    });

    it('truncates long text fields to Notion limits', async (): Promise<void> => {
      mockClient.pages.create.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
      });

      const longText = 'x'.repeat(3000);
      const noteWithLongText: InboxNote = {
        title: 'Note with long text',
        status: 'Inbox',
        source: 'WhatsApp',
        messageType: 'Text',
        contentType: 'Other',
        topics: [],
        originalText: longText,
        capturedAt: '2024-01-01T00:00:00.000Z',
        sender: 'Sender',
        externalId: 'ext-1',
        processedBy: 'None',
      };

      await repo.createNote(noteWithLongText);

      const createCall = mockClient.pages.create.mock.calls[0]?.[0] as
        | { properties: Record<string, unknown> }
        | undefined;
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        const properties = createCall.properties;
        const originalTextProp = properties['Original text'] as {
          rich_text: { text: { content: string } }[];
        };
        expect(originalTextProp.rich_text[0]?.text.content.length).toBeLessThanOrEqual(2000);
        expect(originalTextProp.rich_text[0]?.text.content).toContain('...');
      }
    });

    it('handles non-Error exceptions gracefully', async (): Promise<void> => {
      mockClient.pages.create.mockRejectedValue('String error');

      const result = await repo.createNote(sampleNote);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Unknown Notion error');
      }
    });
  });

  describe('getNote property extraction', () => {
    it('extracts all property types correctly', async (): Promise<void> => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
        properties: {
          Title: {
            title: [{ plain_text: 'Test Note' }],
          },
          Status: {
            select: { name: 'Inbox' },
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
          Topic: {
            multi_select: [{ name: 'AI' }, { name: 'Work' }],
          },
          'Original text': {
            rich_text: [{ plain_text: 'Test message' }],
          },
          'Clean text': {
            rich_text: [{ plain_text: 'Clean message' }],
          },
          Transcript: {
            rich_text: [{ plain_text: 'Transcript text' }],
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
          'Processing run id': {
            rich_text: [{ plain_text: 'run-456' }],
          },
          'Processed by': {
            select: { name: 'MasterNotesAssistant' },
          },
          Errors: {
            rich_text: [{ plain_text: 'Some error' }],
          },
          URL: {
            url: 'https://example.com',
          },
        },
      });

      const result = await repo.getNote('notion-page-id');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.id).toBe('notion-page-id');
        expect(result.value.title).toBe('Test Note');
        expect(result.value.status).toBe('Inbox');
        expect(result.value.source).toBe('WhatsApp');
        expect(result.value.messageType).toBe('Text');
        expect(result.value.contentType).toBe('Other');
        expect(result.value.topics).toEqual(['AI', 'Work']);
        expect(result.value.originalText).toBe('Test message');
        expect(result.value.cleanText).toBe('Clean message');
        expect(result.value.transcript).toBe('Transcript text');
        expect(result.value.sender).toBe('Test User');
        expect(result.value.externalId).toBe('msg-123');
        expect(result.value.processingRunId).toBe('run-456');
        expect(result.value.processedBy).toBe('MasterNotesAssistant');
        expect(result.value.errors).toBe('Some error');
        expect(result.value.url).toBe('https://example.com');
      }
    });

    it('handles missing optional properties', async (): Promise<void> => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
        properties: {
          Title: {
            title: [{ plain_text: 'Test Note' }],
          },
          Status: {
            select: { name: 'Inbox' },
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
          Topic: {
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
          'Clean text': {
            rich_text: [],
          },
          Transcript: {
            rich_text: [],
          },
          'Processing run id': {
            rich_text: [],
          },
          Errors: {
            rich_text: [],
          },
          URL: {
            url: null,
          },
        },
      });

      const result = await repo.getNote('notion-page-id');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.cleanText).toBeUndefined();
        expect(result.value.transcript).toBeUndefined();
        expect(result.value.processingRunId).toBeUndefined();
        expect(result.value.errors).toBeUndefined();
        expect(result.value.url).toBeUndefined();
      }
    });

    it('handles malformed property values gracefully', async (): Promise<void> => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'notion-page-id',
        object: 'page',
        properties: {
          Title: {},
          Status: {},
          Source: { select: null },
          'Message type': { select: {} },
          Type: 'invalid',
          Topic: { multi_select: 'not-an-array' },
          'Original text': { rich_text: 'not-an-array' },
          'Captured at': { date: null },
          Sender: { rich_text: [] },
          'External ID': { rich_text: [{}] },
          'Processed by': { select: { name: undefined } },
          URL: { url: 123 },
        },
      });

      const result = await repo.getNote('notion-page-id');

      expect(result.ok).toBe(true);
      if (result.ok && result.value !== null) {
        expect(result.value.title).toBe('');
        expect(result.value.status).toBe('');
        expect(result.value.source).toBe('');
        expect(result.value.topics).toEqual([]);
        expect(result.value.originalText).toBe('');
      }
    });
  });
});
