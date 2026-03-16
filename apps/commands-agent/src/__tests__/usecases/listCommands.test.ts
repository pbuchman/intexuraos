import { describe, it, expect, beforeEach } from 'vitest';
import { createListCommandsUseCase } from '../../domain/usecases/listCommands.js';
import { FakeCommandRepository } from '../fakes.js';
import type { Command } from '../../domain/models/command.js';
import pino from 'pino';

describe('listCommands usecase', () => {
  let commandRepository: FakeCommandRepository;
  const logger = pino({ name: 'test', level: 'silent' });

  beforeEach(() => {
    commandRepository = new FakeCommandRepository();
  });

  it('returns empty array when no commands for user', async () => {
    const usecase = createListCommandsUseCase({ commandRepository, logger });

    const result = await usecase.execute('user-empty');

    expect(result.commands).toHaveLength(0);
  });

  it('returns commands for matching user', async () => {
    const cmd1: Command = {
      id: 'cmd-1',
      userId: 'user-abc',
      sourceType: 'whatsapp_text' as const,
      externalId: 'ext-1',
      text: 'Test command 1',
      timestamp: '2025-01-01T00:00:00.000Z',
      status: 'received' as const,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    const cmd2: Command = {
      id: 'cmd-2',
      userId: 'user-abc',
      sourceType: 'whatsapp_text' as const,
      externalId: 'ext-2',
      text: 'Test command 2',
      timestamp: '2025-01-01T00:00:01.000Z',
      status: 'received' as const,
      createdAt: '2025-01-01T00:00:01.000Z',
      updatedAt: '2025-01-01T00:00:01.000Z',
    };

    const cmd3: Command = {
      id: 'cmd-3',
      userId: 'user-xyz',
      sourceType: 'whatsapp_text' as const,
      externalId: 'ext-3',
      text: 'Test command 3',
      timestamp: '2025-01-01T00:00:02.000Z',
      status: 'received' as const,
      createdAt: '2025-01-01T00:00:02.000Z',
      updatedAt: '2025-01-01T00:00:02.000Z',
    };

    commandRepository.addCommand(cmd1);
    commandRepository.addCommand(cmd2);
    commandRepository.addCommand(cmd3);

    const usecase = createListCommandsUseCase({ commandRepository, logger });

    const result = await usecase.execute('user-abc');

    expect(result.commands).toHaveLength(2);
  });

  it('does not return commands from other users', async () => {
    const cmd: Command = {
      id: 'cmd-1',
      userId: 'user-one',
      sourceType: 'whatsapp_text' as const,
      externalId: 'ext-1',
      text: 'Test command 1',
      timestamp: '2025-01-01T00:00:00.000Z',
      status: 'received' as const,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    commandRepository.addCommand(cmd);

    const usecase = createListCommandsUseCase({ commandRepository, logger });

    const result = await usecase.execute('user-two');

    expect(result.commands).toHaveLength(0);
  });
});
