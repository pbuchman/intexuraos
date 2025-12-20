/**
 * Tests for IngestWhatsAppMessage use case.
 */
import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@praxos/common';
import { IngestWhatsAppMessage } from '../usecases/IngestWhatsAppMessage.js';
import type { WhatsAppMessage } from '../usecases/IngestWhatsAppMessage.js';
import type { InboxNotesRepository, InboxError } from '../ports/repositories.js';
import type { InboxNote } from '../models/InboxNote.js';

describe('IngestWhatsAppMessage', () => {
  it('should create a new inbox note from WhatsApp text message', async () => {
    const mockNote: InboxNote = {
      id: 'note-123',
      title: 'WA: Hello world',
      status: 'Inbox',
      source: 'WhatsApp',
      messageType: 'Text',
      type: 'Other',
      topics: [],
      originalText: 'Hello world',
      media: [],
      capturedAt: new Date('2025-12-20T12:00:00Z'),
      sender: '+1234567890',
      externalId: 'wamid.123',
      processedBy: 'None',
      actionIds: [],
    };

    const mockRepository: InboxNotesRepository = {
      getByExternalId: vi.fn().mockResolvedValue(ok(null)),
      create: vi.fn().mockResolvedValue(ok(mockNote)),
      getById: vi.fn(),
      update: vi.fn(),
      queryByStatus: vi.fn(),
    };

    const message: WhatsAppMessage = {
      messageId: 'wamid.123',
      from: '+1234567890',
      timestamp: '2025-12-20T12:00:00Z',
      type: 'text',
      text: 'Hello world',
    };

    const useCase = new IngestWhatsAppMessage(mockRepository);
    const result = await useCase.execute(message);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('note-123');
      expect(result.value.title).toBe('WA: Hello world');
      expect(result.value.source).toBe('WhatsApp');
      expect(result.value.messageType).toBe('Text');
      expect(result.value.externalId).toBe('wamid.123');
    }

    expect(mockRepository.getByExternalId).toHaveBeenCalledWith('wamid.123');
    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'WhatsApp',
        messageType: 'Text',
        originalText: 'Hello world',
        externalId: 'wamid.123',
      })
    );
  });

  it('should truncate long messages in title', async () => {
    const longText = 'a'.repeat(100);
    const mockNote: InboxNote = {
      id: 'note-123',
      title: `WA: ${'a'.repeat(50)}...`,
      status: 'Inbox',
      source: 'WhatsApp',
      messageType: 'Text',
      type: 'Other',
      topics: [],
      originalText: longText,
      media: [],
      capturedAt: new Date(),
      processedBy: 'None',
      actionIds: [],
    };

    const mockRepository: InboxNotesRepository = {
      getByExternalId: vi.fn().mockResolvedValue(ok(null)),
      create: vi.fn().mockResolvedValue(ok(mockNote)),
      getById: vi.fn(),
      update: vi.fn(),
      queryByStatus: vi.fn(),
    };

    const message: WhatsAppMessage = {
      messageId: 'wamid.456',
      from: '+1234567890',
      timestamp: '2025-12-20T12:00:00Z',
      type: 'text',
      text: longText,
    };

    const useCase = new IngestWhatsAppMessage(mockRepository);
    const result = await useCase.execute(message);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toMatch(/^WA: a{50}\.\.\./);
    }
  });

  it('should return existing note if message already processed (idempotency)', async () => {
    const existingNote: InboxNote = {
      id: 'note-existing',
      title: 'WA: Already processed',
      status: 'Processed',
      source: 'WhatsApp',
      messageType: 'Text',
      type: 'Other',
      topics: [],
      originalText: 'Already processed',
      media: [],
      capturedAt: new Date(),
      externalId: 'wamid.duplicate',
      processedBy: 'None',
      actionIds: [],
    };

    const mockRepository: InboxNotesRepository = {
      getByExternalId: vi.fn().mockResolvedValue(ok(existingNote)),
      create: vi.fn(),
      getById: vi.fn(),
      update: vi.fn(),
      queryByStatus: vi.fn(),
    };

    const message: WhatsAppMessage = {
      messageId: 'wamid.duplicate',
      from: '+1234567890',
      timestamp: '2025-12-20T12:00:00Z',
      type: 'text',
      text: 'Duplicate message',
    };

    const useCase = new IngestWhatsAppMessage(mockRepository);
    const result = await useCase.execute(message);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('note-existing');
    }

    expect(mockRepository.getByExternalId).toHaveBeenCalledWith('wamid.duplicate');
    expect(mockRepository.create).not.toHaveBeenCalled();
  });

  it('should handle audio messages with media', async () => {
    const mockNote: InboxNote = {
      id: 'note-audio',
      title: 'WA: audio message',
      status: 'Inbox',
      source: 'WhatsApp',
      messageType: 'Audio',
      type: 'Other',
      topics: [],
      originalText: '',
      media: [{ name: 'voice.ogg', url: 'https://cdn.example.com/voice.ogg' }],
      capturedAt: new Date(),
      externalId: 'wamid.audio',
      processedBy: 'None',
      actionIds: [],
    };

    const mockRepository: InboxNotesRepository = {
      getByExternalId: vi.fn().mockResolvedValue(ok(null)),
      create: vi.fn().mockResolvedValue(ok(mockNote)),
      getById: vi.fn(),
      update: vi.fn(),
      queryByStatus: vi.fn(),
    };

    const message: WhatsAppMessage = {
      messageId: 'wamid.audio',
      from: '+1234567890',
      timestamp: '2025-12-20T12:00:00Z',
      type: 'audio',
      mediaUrl: 'https://cdn.example.com/voice.ogg',
      mediaFilename: 'voice.ogg',
    };

    const useCase = new IngestWhatsAppMessage(mockRepository);
    const result = await useCase.execute(message);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messageType).toBe('Audio');
      expect(result.value.media).toHaveLength(1);
      expect(result.value.media[0].name).toBe('voice.ogg');
    }

    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'Audio',
        media: [{ name: 'voice.ogg', url: 'https://cdn.example.com/voice.ogg' }],
      })
    );
  });

  it('should propagate repository errors', async () => {
    const mockError: InboxError = {
      code: 'INTERNAL_ERROR',
      message: 'Database connection failed',
    };

    const mockRepository: InboxNotesRepository = {
      getByExternalId: vi.fn().mockResolvedValue(err(mockError)),
      create: vi.fn(),
      getById: vi.fn(),
      update: vi.fn(),
      queryByStatus: vi.fn(),
    };

    const message: WhatsAppMessage = {
      messageId: 'wamid.error',
      from: '+1234567890',
      timestamp: '2025-12-20T12:00:00Z',
      type: 'text',
      text: 'Error message',
    };

    const useCase = new IngestWhatsAppMessage(mockRepository);
    const result = await useCase.execute(message);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).toBe('Database connection failed');
    }
  });

  it('should handle image message type', async () => {
    const mockNote: InboxNote = {
      id: 'note-image',
      title: 'WA: image message',
      status: 'Inbox',
      source: 'WhatsApp',
      messageType: 'Image',
      type: 'Other',
      topics: [],
      originalText: '',
      media: [{ name: 'photo.jpg', url: 'https://cdn.example.com/photo.jpg' }],
      capturedAt: new Date(),
      processedBy: 'None',
      actionIds: [],
    };

    const mockRepository: InboxNotesRepository = {
      getByExternalId: vi.fn().mockResolvedValue(ok(null)),
      create: vi.fn().mockResolvedValue(ok(mockNote)),
      getById: vi.fn(),
      update: vi.fn(),
      queryByStatus: vi.fn(),
    };

    const message: WhatsAppMessage = {
      messageId: 'wamid.image',
      from: '+1234567890',
      timestamp: '2025-12-20T12:00:00Z',
      type: 'image',
      mediaUrl: 'https://cdn.example.com/photo.jpg',
      mediaFilename: 'photo.jpg',
    };

    const useCase = new IngestWhatsAppMessage(mockRepository);
    const result = await useCase.execute(message);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messageType).toBe('Image');
    }
  });
});
