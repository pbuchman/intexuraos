import { LlmModels } from '@intexuraos/llm-contract';
import { describe, it, expect, beforeEach } from 'vitest';
import { ok, type Result } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { createRetryPendingCommandsUseCase } from '../../domain/usecases/retryPendingCommands.js';
import type { Command } from '../../domain/models/command.js';
import {
  FakeCommandRepository,
  FakeActionsAgentClient,
  FakeClassifier,
  FakeUserServiceClient,
  FakeEventPublisher,
} from '../fakes.js';
import pino from 'pino';

describe('retryPendingCommands usecase', () => {
  let commandRepository: FakeCommandRepository;
  let actionsAgentClient: FakeActionsAgentClient;
  let classifier: FakeClassifier;
  let userServiceClient: FakeUserServiceClient;
  let eventPublisher: FakeEventPublisher;
  const logger = pino({ name: 'test', level: 'silent' });

  // Create a fake LLM client for use in tests
  const createFakeLlmClient = (fakeClassifier: FakeClassifier): LlmGenerateClient => ({
    async generate(): Promise<
      Result<
        { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } },
        { code: 'API_ERROR'; message: string }
      >
    > {
      const result = await fakeClassifier.classify('');
      if (result.type === 'unclassified') {
        return ok({
          content: JSON.stringify(result),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.0001 },
        });
      }
      return ok({
        content: JSON.stringify(result),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.0001 },
      });
    },
  });

  const createCommand = (overrides: Partial<Command> = {}): Command => ({
    id: 'cmd-123',
    userId: 'user-456',
    sourceType: 'whatsapp_text',
    externalId: 'msg-123',
    text: 'Research AI trends',
    timestamp: '2025-01-01T12:00:00.000Z',
    status: 'pending_classification',
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    commandRepository = new FakeCommandRepository();
    actionsAgentClient = new FakeActionsAgentClient();
    classifier = new FakeClassifier();
    userServiceClient = new FakeUserServiceClient();
    eventPublisher = new FakeEventPublisher();

    // Set up the fake LLM client result
    userServiceClient.setLlmClientResult(ok(createFakeLlmClient(classifier)));
  });

  it('returns empty result when no pending commands', async () => {
    const usecase = createRetryPendingCommandsUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory: () => classifier,
      userServiceClient,
      eventPublisher,
      logger,
    });

    const result = await usecase.execute();

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(0);
    expect(result.skipReasons).toEqual({});
  });

  it('skips command when fetching API keys fails', async () => {
    const command = createCommand();
    commandRepository.addCommand(command);
    userServiceClient.setFailNext(true);

    const usecase = createRetryPendingCommandsUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory: () => classifier,
      userServiceClient,
      eventPublisher,
      logger,
    });

    const result = await usecase.execute();

    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipReasons).toEqual({ llm_client_fetch_failed: 1 });
  });

  it('skips command when user has no Google API key', async () => {
    const command = createCommand();
    commandRepository.addCommand(command);
    userServiceClient.setApiKeys('user-456', {});

    const usecase = createRetryPendingCommandsUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory: () => classifier,
      userServiceClient,
      eventPublisher,
      logger,
    });

    const result = await usecase.execute();

    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(result.skipReasons).toEqual({ llm_client_fetch_failed: 1 });
  });

  it('processes command successfully when classification is not unclassified', async () => {
    const command = createCommand();
    commandRepository.addCommand(command);
    userServiceClient.setApiKeys('user-456', { google: 'google-key' });
    classifier.setResult({
      type: 'research',
      confidence: 0.95,
      title: 'AI Trends Research',
      reasoning: 'Research task',
    });

    const usecase = createRetryPendingCommandsUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory: () => classifier,
      userServiceClient,
      eventPublisher,
      logger,
    });

    const result = await usecase.execute();

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    const updatedCommand = await commandRepository.getById('cmd-123');
    expect(updatedCommand?.status).toBe('classified');
  });

  it('fails command when action creation fails', async () => {
    const command = createCommand();
    commandRepository.addCommand(command);
    userServiceClient.setApiKeys('user-456', { google: 'google-key' });
    classifier.setResult({
      type: 'research',
      confidence: 0.95,
      title: 'AI Trends Research',
      reasoning: 'Research task',
    });
    actionsAgentClient.setFailNext(true);

    const usecase = createRetryPendingCommandsUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory: () => classifier,
      userServiceClient,
      eventPublisher,
      logger,
    });

    const result = await usecase.execute();

    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
  });

  it('includes selectedModels in event when present in classification', async () => {
    const command = createCommand();
    commandRepository.addCommand(command);
    userServiceClient.setApiKeys('user-456', { google: 'google-key' });
    classifier.setResult({
      type: 'research',
      confidence: 0.95,
      title: 'AI Trends Research',
      reasoning: 'Research task',
      selectedModels: [LlmModels.Gemini25Flash, LlmModels.O4MiniDeepResearch],
    });

    const usecase = createRetryPendingCommandsUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory: () => classifier,
      userServiceClient,
      eventPublisher,
      logger,
    });

    await usecase.execute();

    const events = eventPublisher.getPublishedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.selectedModels).toEqual([
      LlmModels.Gemini25Flash,
      LlmModels.O4MiniDeepResearch,
    ]);
  });

  it('handles unclassified type without creating action', async () => {
    const command = createCommand();
    commandRepository.addCommand(command);
    userServiceClient.setApiKeys('user-456', { google: 'google-key' });
    classifier.setResult({
      type: 'unclassified',
      confidence: 0.1,
      title: 'Unknown',
      reasoning: 'Cannot determine type',
    });

    const usecase = createRetryPendingCommandsUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory: () => classifier,
      userServiceClient,
      eventPublisher,
      logger,
    });

    const result = await usecase.execute();

    expect(result.processed).toBe(1);

    const events = eventPublisher.getPublishedEvents();
    expect(events).toHaveLength(0);

    const actions = actionsAgentClient.getCreatedActions();
    expect(actions).toHaveLength(0);
  });

  it('marks command as failed when classification throws', async () => {
    const command = createCommand();
    commandRepository.addCommand(command);
    userServiceClient.setApiKeys('user-456', { google: 'google-key' });
    classifier.setFailNext(true);

    const usecase = createRetryPendingCommandsUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory: () => classifier,
      userServiceClient,
      eventPublisher,
      logger,
    });

    const result = await usecase.execute();

    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);

    const updatedCommand = await commandRepository.getById('cmd-123');
    expect(updatedCommand?.status).toBe('failed');
    expect(updatedCommand?.failureReason).toContain('classification failure');
  });

  it('processes multiple commands independently', async () => {
    commandRepository.addCommand(createCommand({ id: 'cmd-1', userId: 'user-1' }));
    commandRepository.addCommand(createCommand({ id: 'cmd-2', userId: 'user-2' }));
    commandRepository.addCommand(createCommand({ id: 'cmd-3', userId: 'user-3' }));

    userServiceClient.setApiKeys('user-1', { google: 'key-1' });
    userServiceClient.setApiKeys('user-2', {});
    userServiceClient.setApiKeys('user-3', { google: 'key-3' });

    classifier.setResult({
      type: 'todo',
      confidence: 0.9,
      title: 'Task',
      reasoning: 'Todo task',
    });

    const usecase = createRetryPendingCommandsUseCase({
      commandRepository,
      actionsAgentClient,
      classifierFactory: () => classifier,
      userServiceClient,
      eventPublisher,
      logger,
    });

    const result = await usecase.execute();

    expect(result.total).toBe(3);
    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.skipReasons).toEqual({ llm_client_fetch_failed: 1 });
  });
});
