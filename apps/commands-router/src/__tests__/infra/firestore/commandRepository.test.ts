/**
 * Tests for Firestore command repository.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { createFirestoreCommandRepository } from '../../../infra/firestore/commandRepository.js';
import type { CommandRepository } from '../../../domain/ports/commandRepository.js';
import type { Command, CommandSourceType, CommandStatus } from '../../../domain/models/command.js';

function createTestCommand(overrides: Partial<Command> = {}): Command {
  const now = new Date().toISOString();
  return {
    id: 'command-123',
    userId: 'user-123',
    sourceType: 'whatsapp_text' as CommandSourceType,
    externalId: 'wamid.123',
    text: 'Test command text',
    timestamp: now,
    status: 'received' as CommandStatus,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('FirestoreCommandRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: CommandRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    repository = createFirestoreCommandRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('getById', () => {
    it('returns null for non-existent command', async () => {
      const result = await repository.getById('nonexistent');
      expect(result).toBeNull();
    });

    it('returns command for existing id', async () => {
      const command = createTestCommand();
      await repository.save(command);

      const result = await repository.getById(command.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(command.id);
      expect(result?.userId).toBe('user-123');
      expect(result?.text).toBe('Test command text');
    });

    it('returns command with classification', async () => {
      const command = createTestCommand({
        classification: {
          type: 'research',
          confidence: 0.95,
          reasoning: 'User wants to research this topic',
          classifiedAt: new Date().toISOString(),
        },
      });
      await repository.save(command);

      const result = await repository.getById(command.id);

      expect(result?.classification).toBeDefined();
      expect(result?.classification?.type).toBe('research');
      expect(result?.classification?.confidence).toBe(0.95);
    });

    it('returns command with actionId', async () => {
      const command = createTestCommand({ actionId: 'action-456' });
      await repository.save(command);

      const result = await repository.getById(command.id);

      expect(result?.actionId).toBe('action-456');
    });

    it('returns command with failureReason', async () => {
      const command = createTestCommand({
        status: 'failed' as CommandStatus,
        failureReason: 'Classification failed',
      });
      await repository.save(command);

      const result = await repository.getById(command.id);

      expect(result?.status).toBe('failed');
      expect(result?.failureReason).toBe('Classification failed');
    });
  });

  describe('save', () => {
    it('saves new command', async () => {
      const command = createTestCommand();

      await repository.save(command);

      const result = await repository.getById(command.id);
      expect(result).not.toBeNull();
      expect(result?.text).toBe('Test command text');
    });

    it('saves command with all optional fields', async () => {
      const command = createTestCommand({
        classification: {
          type: 'todo',
          confidence: 0.88,
          reasoning: 'This is a task',
          classifiedAt: new Date().toISOString(),
        },
        actionId: 'action-789',
        failureReason: 'None',
      });

      await repository.save(command);

      const result = await repository.getById(command.id);
      expect(result?.classification?.type).toBe('todo');
      expect(result?.actionId).toBe('action-789');
      expect(result?.failureReason).toBe('None');
    });
  });

  describe('update', () => {
    it('updates existing command', async () => {
      const command = createTestCommand();
      await repository.save(command);

      const updated: Command = {
        ...command,
        status: 'classified' as CommandStatus,
        text: 'Updated text',
      };
      await repository.update(updated);

      const result = await repository.getById(command.id);
      expect(result?.status).toBe('classified');
      expect(result?.text).toBe('Updated text');
    });

    it('updates timestamp on update', async () => {
      const command = createTestCommand();
      await repository.save(command);

      const originalUpdatedAt = command.updatedAt;
      await new Promise((resolve) => setTimeout(resolve, 10));

      await repository.update({ ...command, status: 'pending_classification' as CommandStatus });

      const result = await repository.getById(command.id);
      expect(result?.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('adds classification to existing command', async () => {
      const command = createTestCommand();
      await repository.save(command);

      const updated: Command = {
        ...command,
        classification: {
          type: 'research',
          confidence: 0.92,
          reasoning: 'Research request detected',
          classifiedAt: new Date().toISOString(),
        },
      };
      await repository.update(updated);

      const result = await repository.getById(command.id);
      expect(result?.classification?.type).toBe('research');
    });
  });

  describe('delete', () => {
    it('deletes existing command', async () => {
      const command = createTestCommand();
      await repository.save(command);

      await repository.delete(command.id);

      const result = await repository.getById(command.id);
      expect(result).toBeNull();
    });

    it('succeeds for non-existent command', async () => {
      await expect(repository.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('listByUserId', () => {
    it('returns empty array for user with no commands', async () => {
      const result = await repository.listByUserId('user-no-commands');
      expect(result).toEqual([]);
    });

    it('returns commands for user', async () => {
      await repository.save(createTestCommand({ id: 'cmd-1', userId: 'user-123' }));
      await repository.save(createTestCommand({ id: 'cmd-2', userId: 'user-123' }));
      await repository.save(createTestCommand({ id: 'cmd-3', userId: 'other-user' }));

      const result = await repository.listByUserId('user-123');

      expect(result).toHaveLength(2);
      expect(result.every((c) => c.userId === 'user-123')).toBe(true);
    });

    it('returns commands with correct source type', async () => {
      await repository.save(
        createTestCommand({ sourceType: 'whatsapp_text' as CommandSourceType })
      );

      const result = await repository.listByUserId('user-123');

      expect(result[0]?.sourceType).toBe('whatsapp_text');
    });
  });

  describe('listByStatus', () => {
    it('returns empty array when no commands with status', async () => {
      await repository.save(createTestCommand({ status: 'classified' as CommandStatus }));

      const result = await repository.listByStatus('received' as CommandStatus);

      expect(result).toEqual([]);
    });

    it('returns commands with matching status', async () => {
      await repository.save(
        createTestCommand({ id: 'cmd-1', status: 'received' as CommandStatus })
      );
      await repository.save(
        createTestCommand({ id: 'cmd-2', status: 'received' as CommandStatus })
      );
      await repository.save(
        createTestCommand({ id: 'cmd-3', status: 'classified' as CommandStatus })
      );

      const result = await repository.listByStatus('received' as CommandStatus);

      expect(result).toHaveLength(2);
      expect(result.every((c) => c.status === 'received')).toBe(true);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await repository.save(
          createTestCommand({ id: `cmd-${String(i)}`, status: 'received' as CommandStatus })
        );
      }

      const result = await repository.listByStatus('received' as CommandStatus, 2);

      expect(result).toHaveLength(2);
    });

    it('returns commands for different statuses', async () => {
      await repository.save(
        createTestCommand({ id: 'cmd-1', status: 'pending_classification' as CommandStatus })
      );
      await repository.save(createTestCommand({ id: 'cmd-2', status: 'failed' as CommandStatus }));

      const pendingClassification = await repository.listByStatus(
        'pending_classification' as CommandStatus
      );
      const failed = await repository.listByStatus('failed' as CommandStatus);

      expect(pendingClassification).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(pendingClassification[0]?.status).toBe('pending_classification');
      expect(failed[0]?.status).toBe('failed');
    });
  });
});
