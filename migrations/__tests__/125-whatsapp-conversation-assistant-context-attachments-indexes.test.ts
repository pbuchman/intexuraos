import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  indexes,
  metadata,
  up,
} from '../125_whatsapp-conversation-assistant-context-attachments-indexes.mjs'; // @allow-missing-js -- .mjs import

const ascending = (fieldPath: string): { fieldPath: string; order: 'ASCENDING' } => ({
  fieldPath,
  order: 'ASCENDING',
});
const descending = (fieldPath: string): { fieldPath: string; order: 'DESCENDING' } => ({
  fieldPath,
  order: 'DESCENDING',
});

describe('migration 125 - WhatsApp Conversation Assistant context attachment indexes', () => {
  it('is reserved in the immutable migration manifest with its exact checksum', () => {
    const migrationBytes = readFileSync(
      new URL(
        '../125_whatsapp-conversation-assistant-context-attachments-indexes.mjs',
        import.meta.url
      ),
      'utf8'
    );
    const manifest = JSON.parse(
      readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
    ) as {
      entries: { id: string; name: string; checksum: string }[];
    };

    expect(manifest.entries.find((entry) => entry.id === '125')).toEqual({
      id: '125',
      name: 'whatsapp-conversation-assistant-context-attachments-indexes',
      checksum: `sha256:${createHash('sha256').update(migrationBytes).digest('hex')}`,
    });
  });

  it('defines the source journal and out-of-order relation indexes used by exact cutoff capture', () => {
    expect(metadata).toEqual({
      id: '125',
      name: 'whatsapp-conversation-assistant-context-attachments-indexes',
      description:
        'Indexes for private WhatsApp context journals, context attachments, and durable Assistant turns',
      createdAt: '2026-07-21',
    });
    expect(indexes).toEqual(
      expect.arrayContaining([
        {
          collectionGroup: 'whatsapp_private_context_changes',
          queryScope: 'COLLECTION',
          fields: [
            ascending('sourceAccountId'),
            ascending('chatId'),
            ascending('sequence'),
            ascending('__name__'),
          ],
        },
        {
          collectionGroup: 'whatsapp_private_messages',
          queryScope: 'COLLECTION',
          fields: [
            ascending('sourceAccountId'),
            ascending('chatId'),
            ascending('relation.targetMatrixEventId'),
            ascending('relation.applicationStatus'),
            ascending('eventTimestamp'),
            ascending('__name__'),
          ],
        },
        {
          collectionGroup: 'whatsapp_private_messages',
          queryScope: 'COLLECTION',
          fields: [
            ascending('sourceAccountId'),
            ascending('chatId'),
            ascending('relation.targetMatrixEventId'),
            ascending('eventTimestamp'),
            ascending('__name__'),
          ],
        },
        {
          collectionGroup: 'whatsapp_private_messages',
          queryScope: 'COLLECTION',
          fields: [
            ascending('sourceAccountId'),
            ascending('chatId'),
            ascending('messageType'),
            ascending('reaction.targetMatrixEventId'),
            ascending('eventTimestamp'),
            ascending('__name__'),
          ],
        },
        {
          collectionGroup: 'whatsapp_private_messages',
          queryScope: 'COLLECTION',
          fields: [
            ascending('sourceAccountId'),
            ascending('chatId'),
            ascending('relation.targetMessageId'),
            ascending('relation.kind'),
            descending('eventTimestamp'),
            descending('__name__'),
          ],
        },
        {
          collectionGroup: 'whatsapp_private_messages',
          queryScope: 'COLLECTION',
          fields: [
            ascending('sourceAccountId'),
            ascending('chatId'),
            ascending('relation.kind'),
            ascending('relation.targetMatrixEventId'),
            ascending('relation.applicationStatus'),
            ascending('eventTimestamp'),
            ascending('__name__'),
          ],
        },
      ])
    );
  });

  it('defines attachment lifecycle, ordered turn, request recovery, and cascade indexes', () => {
    expect(indexes).toEqual(
      expect.arrayContaining([
        {
          collectionGroup: 'whatsapp_conversation_assistant_context_attachments',
          queryScope: 'COLLECTION',
          fields: [
            ascending('sessionId'),
            ascending('userId'),
            ascending('capturedAt'),
            ascending('__name__'),
          ],
        },
        {
          collectionGroup: 'whatsapp_conversation_assistant_context_attachments',
          queryScope: 'COLLECTION',
          fields: [ascending('status'), ascending('expireAt'), ascending('__name__')],
        },
        {
          collectionGroup: 'whatsapp_conversation_assistant_context_attachments',
          queryScope: 'COLLECTION',
          fields: [ascending('sessionId'), ascending('sessionGenerationId'), ascending('__name__')],
        },
        {
          collectionGroup: 'whatsapp_conversation_assistant_turns',
          queryScope: 'COLLECTION',
          fields: [
            ascending('sessionId'),
            ascending('userId'),
            ascending('sequence'),
            ascending('__name__'),
          ],
        },
        {
          collectionGroup: 'whatsapp_conversation_assistant_turns',
          queryScope: 'COLLECTION',
          fields: [
            ascending('sessionId'),
            ascending('userId'),
            ascending('conversationRevision'),
            ascending('sequence'),
            ascending('__name__'),
          ],
        },
        {
          collectionGroup: 'whatsapp_conversation_assistant_turn_requests',
          queryScope: 'COLLECTION',
          fields: [
            ascending('sessionId'),
            ascending('userId'),
            ascending('createdAt'),
            ascending('__name__'),
          ],
        },
        {
          collectionGroup: 'whatsapp_conversation_assistant_turn_requests',
          queryScope: 'COLLECTION',
          fields: [ascending('sessionId'), ascending('sessionGenerationId'), ascending('__name__')],
        },
      ])
    );
  });

  it('deploys all aggregated indexes and propagates deployment failures', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await up({ deployIndexes });
    expect(deployIndexes).toHaveBeenCalledOnce();

    const failedDeploy = vi.fn().mockRejectedValue(new Error('deploy failed'));
    await expect(up({ deployIndexes: failedDeploy })).rejects.toThrow('deploy failed');
    consoleSpy.mockRestore();
  });
});
