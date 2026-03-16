import { describe, it, expect, beforeEach } from 'vitest';
import { createDeleteCommandUseCase } from '../../domain/usecases/deleteCommand.js';
import { FakeCommandRepository } from '../fakes.js';
import pino from 'pino';
import type { Command } from '../../domain/models/command.js';

describe('deleteCommand usecase', () => {
  let commandRepository: FakeCommandRepository;
  const logger = pino({ name: 'test', level: 'silent' });

  beforeEach(() => {
    commandRepository = new FakeCommandRepository();
  });

  function makeCommand(overrides: Partial<Command> = {}): Command {
    return {
      id: 'cmd-test',
      userId: 'user-owner',
      sourceType: 'whatsapp_text' as const,
      externalId: 'ext-1',
      text: 'Test command',
      timestamp: '2025-01-01T00:00:00.000Z',
      status: 'received' as const,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  describe('error paths', () => {
    it('returns NOT_FOUND when command does not exist', async () => {
      const usecase = createDeleteCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('non-existent', 'user-1');

      expect(result.success).toBe(false);
      expect(result).toEqual({
        success: false,
        error: 'NOT_FOUND',
        message: 'Command not found',
      });
    });

    it('returns NOT_FOUND when command belongs to another user', async () => {
      const command = makeCommand({ userId: 'user-owner' });
      commandRepository.addCommand(command);

      const usecase = createDeleteCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-test', 'user-other');

      expect(result.success).toBe(false);
      expect(result).toEqual({
        success: false,
        error: 'NOT_FOUND',
        message: 'Command not found',
      });

      // Verify the command still exists
      const existing = await commandRepository.getById('cmd-test');
      expect(existing).not.toBeNull();
    });

    it('returns INVALID_STATUS for classified command', async () => {
      const command = makeCommand({ status: 'classified' as const });
      commandRepository.addCommand(command);

      const usecase = createDeleteCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-test', 'user-owner');

      expect(result.success).toBe(false);
      expect(result).toEqual({
        success: false,
        error: 'INVALID_STATUS',
        message: 'Cannot delete classified command. Use archive instead.',
      });
    });

    it('returns INVALID_STATUS for archived command', async () => {
      const command = makeCommand({ status: 'archived' as const });
      commandRepository.addCommand(command);

      const usecase = createDeleteCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-test', 'user-owner');

      expect(result.success).toBe(false);
      expect(result).toEqual({
        success: false,
        error: 'INVALID_STATUS',
        message: 'Cannot delete classified command. Use archive instead.',
      });
    });
  });

  describe('success paths', () => {
    it('deletes command with received status', async () => {
      const command = makeCommand({ status: 'received' as const });
      commandRepository.addCommand(command);

      const usecase = createDeleteCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-test', 'user-owner');

      expect(result.success).toBe(true);

      const deleted = await commandRepository.getById('cmd-test');
      expect(deleted).toBeNull();
    });

    it('deletes command with pending_classification status', async () => {
      const command = makeCommand({ status: 'pending_classification' as const });
      commandRepository.addCommand(command);

      const usecase = createDeleteCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-test', 'user-owner');

      expect(result.success).toBe(true);

      const deleted = await commandRepository.getById('cmd-test');
      expect(deleted).toBeNull();
    });

    it('deletes command with failed status', async () => {
      const command = makeCommand({ status: 'failed' as const });
      commandRepository.addCommand(command);

      const usecase = createDeleteCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-test', 'user-owner');

      expect(result.success).toBe(true);

      const deleted = await commandRepository.getById('cmd-test');
      expect(deleted).toBeNull();
    });
  });
});
