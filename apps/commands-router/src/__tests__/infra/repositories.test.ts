import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreCommandRepository } from '../../infra/firestore/commandRepository.js';
import { createFirestoreActionRepository } from '../../infra/firestore/actionRepository.js';
import type { Command } from '../../domain/models/command.js';
import type { Action } from '../../domain/models/action.js';

function createTestCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: 'whatsapp_text:msg-123',
    userId: 'user-123',
    sourceType: 'whatsapp_text',
    externalId: 'msg-123',
    text: 'Buy groceries',
    timestamp: '2025-01-01T12:00:00.000Z',
    status: 'received',
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  };
}

function createTestAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'action-123',
    userId: 'user-123',
    commandId: 'whatsapp_text:msg-123',
    type: 'todo',
    confidence: 0.95,
    title: 'Buy groceries',
    status: 'pending',
    payload: {},
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('Firestore Repositories', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('CommandRepository', () => {
    it('saves and retrieves a command', async () => {
      const repo = createFirestoreCommandRepository();
      const command = createTestCommand();

      await repo.save(command);
      const retrieved = await repo.getById(command.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(command.id);
      expect(retrieved?.text).toBe('Buy groceries');
      expect(retrieved?.status).toBe('received');
    });

    it('returns null for non-existent command', async () => {
      const repo = createFirestoreCommandRepository();
      const result = await repo.getById('non-existent');
      expect(result).toBeNull();
    });

    it('updates a command', async () => {
      const repo = createFirestoreCommandRepository();
      const command = createTestCommand();
      await repo.save(command);

      command.status = 'classified';
      command.classification = {
        type: 'todo',
        confidence: 0.95,
        reasoning: 'User wants to buy groceries',
        classifiedAt: '2025-01-01T12:00:01.000Z',
      };
      command.actionId = 'action-123';
      await repo.update(command);

      const retrieved = await repo.getById(command.id);
      expect(retrieved?.status).toBe('classified');
      expect(retrieved?.classification?.type).toBe('todo');
      expect(retrieved?.actionId).toBe('action-123');
    });

    it('lists commands by user', async () => {
      const repo = createFirestoreCommandRepository();

      await repo.save(createTestCommand({ id: 'cmd-1', userId: 'user-A', text: 'Task 1' }));
      await repo.save(createTestCommand({ id: 'cmd-2', userId: 'user-A', text: 'Task 2' }));
      await repo.save(createTestCommand({ id: 'cmd-3', userId: 'user-B', text: 'Task 3' }));

      const userACommands = await repo.listByUserId('user-A');
      expect(userACommands).toHaveLength(2);

      const userBCommands = await repo.listByUserId('user-B');
      expect(userBCommands).toHaveLength(1);
    });

    it('saves command without classification or actionId', async () => {
      const repo = createFirestoreCommandRepository();
      const command = createTestCommand();
      delete command.classification;
      delete command.actionId;

      await repo.save(command);
      const retrieved = await repo.getById(command.id);

      expect(retrieved?.classification).toBeUndefined();
      expect(retrieved?.actionId).toBeUndefined();
    });

    it('saves and retrieves command with classification and actionId', async () => {
      const repo = createFirestoreCommandRepository();
      const command = createTestCommand({
        id: 'cmd-classified',
        status: 'classified',
        classification: {
          type: 'todo',
          confidence: 0.95,
          reasoning: 'User wants to add a todo',
          classifiedAt: '2025-01-01T12:00:01.000Z',
        },
        actionId: 'action-linked',
      });

      await repo.save(command);
      const retrieved = await repo.getById(command.id);

      expect(retrieved?.classification?.type).toBe('todo');
      expect(retrieved?.classification?.confidence).toBe(0.95);
      expect(retrieved?.actionId).toBe('action-linked');
    });

    it('returns empty list for user with no commands', async () => {
      const repo = createFirestoreCommandRepository();
      const result = await repo.listByUserId('user-with-no-commands');
      expect(result).toHaveLength(0);
    });
  });

  describe('ActionRepository', () => {
    it('saves and retrieves an action', async () => {
      const repo = createFirestoreActionRepository();
      const action = createTestAction();

      await repo.save(action);
      const retrieved = await repo.getById(action.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(action.id);
      expect(retrieved?.title).toBe('Buy groceries');
      expect(retrieved?.type).toBe('todo');
    });

    it('returns null for non-existent action', async () => {
      const repo = createFirestoreActionRepository();
      const result = await repo.getById('non-existent');
      expect(result).toBeNull();
    });

    it('updates an action', async () => {
      const repo = createFirestoreActionRepository();
      const action = createTestAction();
      await repo.save(action);

      action.status = 'completed';
      await repo.update(action);

      const retrieved = await repo.getById(action.id);
      expect(retrieved?.status).toBe('completed');
    });

    it('lists actions by user', async () => {
      const repo = createFirestoreActionRepository();

      await repo.save(createTestAction({ id: 'act-1', userId: 'user-A', title: 'Task 1' }));
      await repo.save(createTestAction({ id: 'act-2', userId: 'user-A', title: 'Task 2' }));
      await repo.save(createTestAction({ id: 'act-3', userId: 'user-B', title: 'Task 3' }));

      const userAActions = await repo.listByUserId('user-A');
      expect(userAActions).toHaveLength(2);

      const userBActions = await repo.listByUserId('user-B');
      expect(userBActions).toHaveLength(1);
    });

    it('returns empty list for user with no actions', async () => {
      const repo = createFirestoreActionRepository();
      const result = await repo.listByUserId('user-with-no-actions');
      expect(result).toHaveLength(0);
    });
  });
});
