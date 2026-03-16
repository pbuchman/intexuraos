import { describe, it, expect, beforeEach } from 'vitest';
import { createArchiveCommandUseCase } from '../../domain/usecases/archiveCommand.js';
import { FakeCommandRepository } from '../fakes.js';
import pino from 'pino';
import type { Command } from '../../domain/models/command.js';

const logger = pino({ name: 'test', level: 'silent' });

describe('archiveCommand usecase', () => {
  let commandRepository: FakeCommandRepository;

  beforeEach(() => {
    commandRepository = new FakeCommandRepository();
  });

  describe('error paths', () => {
    it('returns NOT_FOUND when command does not exist', async () => {
      const usecase = createArchiveCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('non-existent', 'user-1');

      expect(result.success).toBe(false);
      expect(result).toEqual(
        expect.objectContaining({ success: false, error: 'NOT_FOUND' }),
      );
    });

    it('returns NOT_FOUND when command belongs to another user', async () => {
      const command: Command = {
        id: 'cmd-owner',
        userId: 'user-owner',
        sourceType: 'whatsapp_text' as const,
        externalId: 'ext-1',
        text: 'Test command',
        timestamp: '2025-01-01T00:00:00.000Z',
        status: 'classified' as const,
        classification: {
          type: 'todo',
          confidence: 0.9,
          reasoning: 'Test',
          promptVersion: '1.0.0',
          classifiedAt: '2025-01-01T12:00:00.000Z',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      commandRepository.addCommand(command);

      const usecase = createArchiveCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-owner', 'user-other');

      expect(result.success).toBe(false);
      expect(result).toEqual(
        expect.objectContaining({ success: false, error: 'NOT_FOUND' }),
      );

      // Verify command status is still classified
      const persisted = await commandRepository.getById('cmd-owner');
      expect(persisted?.status).toBe('classified');
    });

    it('returns INVALID_STATUS for received command', async () => {
      const command: Command = {
        id: 'cmd-received',
        userId: 'user-1',
        sourceType: 'whatsapp_text' as const,
        externalId: 'ext-2',
        text: 'Test command',
        timestamp: '2025-01-01T00:00:00.000Z',
        status: 'received' as const,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      commandRepository.addCommand(command);

      const usecase = createArchiveCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-received', 'user-1');

      expect(result.success).toBe(false);
      expect(result).toEqual(
        expect.objectContaining({ success: false, error: 'INVALID_STATUS' }),
      );
    });

    it('returns INVALID_STATUS for pending_classification command', async () => {
      const command: Command = {
        id: 'cmd-pending',
        userId: 'user-1',
        sourceType: 'whatsapp_text' as const,
        externalId: 'ext-3',
        text: 'Test command',
        timestamp: '2025-01-01T00:00:00.000Z',
        status: 'pending_classification' as const,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      commandRepository.addCommand(command);

      const usecase = createArchiveCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-pending', 'user-1');

      expect(result.success).toBe(false);
      expect(result).toEqual(
        expect.objectContaining({ success: false, error: 'INVALID_STATUS' }),
      );
    });

    it('returns INVALID_STATUS for failed command', async () => {
      const command: Command = {
        id: 'cmd-failed',
        userId: 'user-1',
        sourceType: 'whatsapp_text' as const,
        externalId: 'ext-4',
        text: 'Test command',
        timestamp: '2025-01-01T00:00:00.000Z',
        status: 'failed' as const,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      commandRepository.addCommand(command);

      const usecase = createArchiveCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-failed', 'user-1');

      expect(result.success).toBe(false);
      expect(result).toEqual(
        expect.objectContaining({ success: false, error: 'INVALID_STATUS' }),
      );
    });
  });

  describe('success paths', () => {
    it('archives classified command', async () => {
      const command: Command = {
        id: 'cmd-test',
        userId: 'user-owner',
        sourceType: 'whatsapp_text' as const,
        externalId: 'ext-1',
        text: 'Test command',
        timestamp: '2025-01-01T00:00:00.000Z',
        status: 'classified' as const,
        classification: {
          type: 'todo',
          confidence: 0.9,
          reasoning: 'Test',
          promptVersion: '1.0.0',
          classifiedAt: '2025-01-01T12:00:00.000Z',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      commandRepository.addCommand(command);

      const usecase = createArchiveCommandUseCase({ commandRepository, logger });

      const result = await usecase.execute('cmd-test', 'user-owner');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.status).toBe('archived');
        expect(result.command.updatedAt).toBeDefined();
      }

      // Verify persisted command has status 'archived'
      const persisted = await commandRepository.getById('cmd-test');
      expect(persisted?.status).toBe('archived');
    });
  });
});
