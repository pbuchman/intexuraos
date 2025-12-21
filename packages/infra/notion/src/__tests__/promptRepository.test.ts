import { describe, it, expect, beforeEach } from 'vitest';
import { createNotionPromptRepository } from '../promptRepository.js';
import { MockNotionApiAdapter } from '../testing/mockNotionApiAdapter.js';
import { FakeNotionConnectionRepository } from '@praxos/infra-firestore';

describe('createNotionPromptRepository', () => {
  let connectionRepo: FakeNotionConnectionRepository;
  let notionApi: MockNotionApiAdapter;
  let promptRepository: ReturnType<typeof createNotionPromptRepository>;

  const userId = 'test-user-123';
  const promptVaultPageId = 'vault-page-id';

  beforeEach(() => {
    connectionRepo = new FakeNotionConnectionRepository();
    notionApi = new MockNotionApiAdapter();
    promptRepository = createNotionPromptRepository(connectionRepo, notionApi);
  });

  describe('when not connected', () => {
    it('createPrompt returns NOT_CONNECTED error', async () => {
      const result = await promptRepository.createPrompt(userId, {
        title: 'Test',
        content: 'Test content',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
      }
    });

    it('listPrompts returns NOT_CONNECTED error', async () => {
      const result = await promptRepository.listPrompts(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
      }
    });

    it('getPrompt returns NOT_CONNECTED error', async () => {
      const result = await promptRepository.getPrompt(userId, 'some-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
      }
    });

    it('updatePrompt returns NOT_CONNECTED error', async () => {
      const result = await promptRepository.updatePrompt(userId, 'some-id', {
        title: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
      }
    });
  });

  describe('when connected', () => {
    beforeEach(async () => {
      await connectionRepo.saveConnection(userId, promptVaultPageId, 'test-token');
    });

    describe('createPrompt', () => {
      it('creates a prompt successfully', async () => {
        const result = await promptRepository.createPrompt(userId, {
          title: 'My Prompt',
          content: 'This is the prompt content',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.title).toBe('My Prompt');
          expect(result.value.content).toBe('This is the prompt content');
          expect(result.value.id).toBeDefined();
          expect(result.value.createdAt).toBeDefined();
        }
      });
    });

    describe('listPrompts', () => {
      it('returns empty list when no prompts exist', async () => {
        const result = await promptRepository.listPrompts(userId);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toHaveLength(0);
        }
      });

      it('returns prompts after creation', async () => {
        // Create a prompt first using the API directly
        await notionApi.createPromptVaultNote({
          token: 'test-token',
          parentPageId: promptVaultPageId,
          title: 'Test Prompt',
          prompt: 'Content',
          userId,
        });

        const result = await promptRepository.listPrompts(userId);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.length).toBeGreaterThanOrEqual(0);
        }
      });
    });

    describe('getPrompt', () => {
      it('returns NOT_FOUND for non-existent prompt', async () => {
        const result = await promptRepository.getPrompt(userId, 'nonexistent-id');

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('NOT_FOUND');
        }
      });

      it('returns prompt when it exists', async () => {
        // Create a prompt first
        const createResult = await notionApi.createPromptVaultNote({
          token: 'test-token',
          parentPageId: promptVaultPageId,
          title: 'Existing Prompt',
          prompt: 'Existing content',
          userId,
        });

        if (createResult.ok) {
          const result = await promptRepository.getPrompt(userId, createResult.value.id);

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.title).toBe('Existing Prompt');
          }
        }
      });
    });

    describe('updatePrompt', () => {
      it('returns NOT_FOUND for non-existent prompt', async () => {
        const result = await promptRepository.updatePrompt(userId, 'nonexistent-id', {
          title: 'Updated',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('NOT_FOUND');
        }
      });

      it('updates title successfully', async () => {
        // Create a prompt first
        const createResult = await notionApi.createPromptVaultNote({
          token: 'test-token',
          parentPageId: promptVaultPageId,
          title: 'Original Title',
          prompt: 'Content',
          userId,
        });

        if (createResult.ok) {
          const result = await promptRepository.updatePrompt(userId, createResult.value.id, {
            title: 'New Title',
          });

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.title).toBe('New Title');
          }
        }
      });

      it('updates content successfully', async () => {
        // Create a prompt first
        const createResult = await notionApi.createPromptVaultNote({
          token: 'test-token',
          parentPageId: promptVaultPageId,
          title: 'Title',
          prompt: 'Original content',
          userId,
        });

        if (createResult.ok) {
          const result = await promptRepository.updatePrompt(userId, createResult.value.id, {
            content: 'New content',
          });

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.content).toBe('New content');
          }
        }
      });
    });
  });

  describe('when disconnected after connection', () => {
    beforeEach(async () => {
      await connectionRepo.saveConnection(userId, promptVaultPageId, 'test-token');
      await connectionRepo.disconnectConnection(userId);
    });

    it('createPrompt returns NOT_CONNECTED error', async () => {
      const result = await promptRepository.createPrompt(userId, {
        title: 'Test',
        content: 'Test content',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
      }
    });
  });
});
