/**
 * Tests for WhatsApp message Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/common';
import type { Firestore } from '@google-cloud/firestore';
import {
  saveMessage,
  getMessagesByUser,
  getMessage,
  deleteMessage,
  findById,
  updateTranscription,
  updateLinkPreview,
} from '../../infra/firestore/index.js';
import type { WhatsAppMessage } from '../../domain/inbox/index.js';

/**
 * Helper to create test message data.
 */
function createTestMessage(
  overrides: Partial<Omit<WhatsAppMessage, 'id'>> = {}
): Omit<WhatsAppMessage, 'id'> {
  return {
    userId: 'user-123',
    waMessageId: 'wamid.test123',
    fromNumber: '+15551234567',
    toNumber: '+15559876543',
    text: 'Test message',
    mediaType: 'text',
    timestamp: '1703721600',
    receivedAt: new Date().toISOString(),
    webhookEventId: 'event-123',
    ...overrides,
  };
}

describe('messageRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('saveMessage', () => {
    it('saves message and returns with generated id', async () => {
      const result = await saveMessage(createTestMessage());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.userId).toBe('user-123');
        expect(result.value.text).toBe('Test message');
      }
    });

    it('saves message with media info', async () => {
      const result = await saveMessage(
        createTestMessage({
          mediaType: 'audio',
          media: {
            id: 'media-123',
            mimeType: 'audio/ogg',
            fileSize: 12345,
          },
          gcsPath: 'gs://bucket/audio.ogg',
        })
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mediaType).toBe('audio');
        expect(result.value.media?.id).toBe('media-123');
        expect(result.value.gcsPath).toBe('gs://bucket/audio.ogg');
      }
    });
  });

  describe('getMessage', () => {
    it('returns null for non-existent message', async () => {
      const result = await getMessage('nonexistent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns message for existing id', async () => {
      const saved = await saveMessage(createTestMessage({ text: 'Hello world' }));
      if (!saved.ok) throw new Error('Setup failed');

      const result = await getMessage(saved.value.id);

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.text).toBe('Hello world');
      }
    });
  });

  describe('getMessagesByUser', () => {
    it('returns empty array for user with no messages', async () => {
      const result = await getMessagesByUser('user-no-messages');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messages).toHaveLength(0);
        expect(result.value.nextCursor).toBeUndefined();
      }
    });

    it('returns messages for user', async () => {
      await saveMessage(createTestMessage({ userId: 'user-123', text: 'Message 1' }));
      await saveMessage(createTestMessage({ userId: 'user-123', text: 'Message 2' }));
      await saveMessage(createTestMessage({ userId: 'other-user', text: 'Other user message' }));

      const result = await getMessagesByUser('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messages.length).toBe(2);
      }
    });

    it('respects limit option', async () => {
      for (let i = 0; i < 5; i++) {
        await saveMessage(createTestMessage({ text: `Message ${String(i)}` }));
      }

      const result = await getMessagesByUser('user-123', { limit: 2 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messages.length).toBe(2);
        expect(result.value.nextCursor).toBeDefined();
      }
    });
  });

  describe('deleteMessage', () => {
    it('deletes existing message', async () => {
      const saved = await saveMessage(createTestMessage());
      if (!saved.ok) throw new Error('Setup failed');

      const deleteResult = await deleteMessage(saved.value.id);
      expect(deleteResult.ok).toBe(true);

      const getResult = await getMessage(saved.value.id);
      expect(getResult.ok && getResult.value).toBeNull();
    });

    it('succeeds even for non-existent message', async () => {
      const result = await deleteMessage('nonexistent');

      expect(result.ok).toBe(true);
    });
  });

  describe('findById', () => {
    it('returns null for non-existent message', async () => {
      const result = await findById('user-123', 'nonexistent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null if message belongs to different user', async () => {
      const saved = await saveMessage(createTestMessage({ userId: 'user-123' }));
      if (!saved.ok) throw new Error('Setup failed');

      const result = await findById('different-user', saved.value.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns message if owned by user', async () => {
      const saved = await saveMessage(createTestMessage({ userId: 'user-123' }));
      if (!saved.ok) throw new Error('Setup failed');

      const result = await findById('user-123', saved.value.id);

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.id).toBe(saved.value.id);
      }
    });
  });

  describe('updateTranscription', () => {
    it('updates transcription state', async () => {
      const saved = await saveMessage(
        createTestMessage({
          userId: 'user-123',
          mediaType: 'audio',
        })
      );
      if (!saved.ok) throw new Error('Setup failed');

      const result = await updateTranscription('user-123', saved.value.id, {
        status: 'completed',
        text: 'Transcribed text here',
        completedAt: new Date().toISOString(),
      });

      expect(result.ok).toBe(true);

      const updated = await getMessage(saved.value.id);
      expect(updated.ok && updated.value?.transcription?.status).toBe('completed');
      expect(updated.ok && updated.value?.transcription?.text).toBe('Transcribed text here');
    });

    it('returns NOT_FOUND for non-existent message', async () => {
      const result = await updateTranscription('user-123', 'nonexistent', {
        status: 'pending',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns NOT_FOUND if message belongs to different user', async () => {
      const saved = await saveMessage(createTestMessage({ userId: 'user-123' }));
      if (!saved.ok) throw new Error('Setup failed');

      const result = await updateTranscription('different-user', saved.value.id, {
        status: 'pending',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('updateLinkPreview', () => {
    it('updates link preview state', async () => {
      const saved = await saveMessage(createTestMessage({ userId: 'user-123' }));
      if (!saved.ok) throw new Error('Setup failed');

      const result = await updateLinkPreview('user-123', saved.value.id, {
        status: 'completed',
        previews: [
          {
            url: 'https://example.com',
            title: 'Example Site',
            description: 'An example',
          },
        ],
      });

      expect(result.ok).toBe(true);

      const updated = await getMessage(saved.value.id);
      expect(updated.ok && updated.value?.linkPreview?.status).toBe('completed');
      expect(updated.ok && updated.value?.linkPreview?.previews?.[0]?.title).toBe('Example Site');
    });

    it('returns NOT_FOUND for non-existent message', async () => {
      const result = await updateLinkPreview('user-123', 'nonexistent', {
        status: 'pending',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('error handling', () => {
    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('DB error') });

      const result = await saveMessage(createTestMessage());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });
});
