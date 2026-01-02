/**
 * Tests for WhatsApp message Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  deleteMessage,
  findById,
  getMessage,
  getMessagesByUser,
  saveMessage,
  updateLinkPreview,
  updateTranscription,
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
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
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

    it('supports cursor-based pagination with valid cursor', async () => {
      // Create 5 messages with unique, decreasing receivedAt timestamps
      for (let i = 0; i < 5; i++) {
        await saveMessage(
          createTestMessage({
            text: `Message ${String(i)}`,
            receivedAt: new Date(Date.now() - i * 1000).toISOString(),
          })
        );
      }

      // Get first page with limit 2
      const firstPage = await getMessagesByUser('user-123', { limit: 2 });
      expect(firstPage.ok).toBe(true);
      if (!firstPage.ok) throw new Error('First page failed');
      expect(firstPage.value.messages.length).toBe(2);
      expect(firstPage.value.nextCursor).toBeDefined();

      // Ensure cursor is defined for use in next page
      const cursor = firstPage.value.nextCursor;
      if (cursor === undefined) throw new Error('Expected cursor to be defined');

      // Use cursor for second page
      const secondPage = await getMessagesByUser('user-123', {
        limit: 2,
        cursor,
      });
      expect(secondPage.ok).toBe(true);
      if (secondPage.ok) {
        expect(secondPage.value.messages.length).toBe(2);
      }
    });

    it('ignores invalid base64 cursor and returns all results', async () => {
      await saveMessage(createTestMessage({ text: 'Message 1' }));
      await saveMessage(createTestMessage({ text: 'Message 2' }));

      // Invalid base64 string - should be ignored, returning results from start
      const result = await getMessagesByUser('user-123', {
        cursor: '!!!invalid-base64!!!',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messages.length).toBe(2);
      }
    });

    it('ignores cursor with missing fields and returns all results', async () => {
      await saveMessage(createTestMessage({ text: 'Message 1' }));
      await saveMessage(createTestMessage({ text: 'Message 2' }));

      // Valid base64 but missing required fields
      const invalidCursor = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');
      const result = await getMessagesByUser('user-123', { cursor: invalidCursor });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messages.length).toBe(2);
      }
    });

    it('ignores cursor with non-string fields and returns all results', async () => {
      await saveMessage(createTestMessage({ text: 'Message 1' }));
      await saveMessage(createTestMessage({ text: 'Message 2' }));

      // Valid base64 but fields are not strings
      const invalidCursor = Buffer.from(JSON.stringify({ receivedAt: 123, id: 456 })).toString(
        'base64'
      );
      const result = await getMessagesByUser('user-123', { cursor: invalidCursor });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messages.length).toBe(2);
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

    it('returns NOT_FOUND if message belongs to different user', async () => {
      const saved = await saveMessage(createTestMessage({ userId: 'user-123' }));
      if (!saved.ok) throw new Error('Setup failed');

      const result = await updateLinkPreview('different-user', saved.value.id, {
        status: 'pending',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('error handling', () => {
    it('returns error when Firestore fails on saveMessage', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('DB error') });

      const result = await saveMessage(createTestMessage());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });

    it('returns error when Firestore fails on getMessage', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read error') });

      const result = await getMessage('some-message-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to get message');
      }
    });

    it('returns error when Firestore fails on getMessagesByUser', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query error') });

      const result = await getMessagesByUser('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to get messages');
      }
    });

    it('returns error when Firestore fails on deleteMessage', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Delete error') });

      const result = await deleteMessage('some-message-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to delete message');
      }
    });

    it('returns error when Firestore fails on findById', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read error') });

      const result = await findById('user-123', 'some-message-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to find message');
      }
    });

    it('returns error when Firestore fails on updateTranscription', async () => {
      const saved = await saveMessage(
        createTestMessage({
          userId: 'user-123',
          mediaType: 'audio',
        })
      );
      if (!saved.ok) throw new Error('Setup failed');

      fakeFirestore.configure({ errorToThrow: new Error('Update error') });

      const result = await updateTranscription('user-123', saved.value.id, {
        status: 'completed',
        text: 'Test transcription',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to update transcription');
      }
    });

    it('returns error when Firestore fails on updateLinkPreview', async () => {
      const saved = await saveMessage(createTestMessage({ userId: 'user-123' }));
      if (!saved.ok) throw new Error('Setup failed');

      fakeFirestore.configure({ errorToThrow: new Error('Update error') });

      const result = await updateLinkPreview('user-123', saved.value.id, {
        status: 'completed',
        previews: [{ url: 'https://example.com', title: 'Example' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to update link preview');
      }
    });
  });
});
