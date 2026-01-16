import { describe, it, expect, beforeEach } from 'vitest';
import { ok } from '@intexuraos/common-core';
import type { Result } from '@intexuraos/common-core';
import type { LlmGenerateClient, GenerateResult, LLMError } from '@intexuraos/llm-factory';
import { createProcessCommandUseCase } from '../../domain/usecases/processCommand.js';
import {
  FakeCommandRepository,
  FakeActionsAgentClient,
  FakeClassifier,
  FakeUserServiceClient,
  FakeEventPublisher,
} from '../fakes.js';
import pino from 'pino';

describe('processCommand usecase', () => {
  let commandRepository: FakeCommandRepository;
  let actionsAgentClient: FakeActionsAgentClient;
  let classifier: FakeClassifier;
  let userServiceClient: FakeUserServiceClient;
  let eventPublisher: FakeEventPublisher;
  const logger = pino({ name: 'test', level: 'silent' });

  // Create a fake LLM client for use in tests
  const createFakeLlmClient: (fakeClassifier: FakeClassifier) => LlmGenerateClient = (fakeClassifier: FakeClassifier): LlmGenerateClient => ({
    async generate(_prompt: string): Promise<Result<GenerateResult, LLMError>> {
      const result = await fakeClassifier.classify('');
      return ok({
        content: JSON.stringify(result),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.0001 },
      });
    },
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

  describe('error paths', () => {
    it('marks command as failed when actions-agent createAction fails (line 147)', async () => {
      const userId = 'user-test-action-fail';
      userServiceClient.setApiKeys(userId, { google: 'google-key' });

      classifier.setResult({
        type: 'research',
        confidence: 0.95,
        title: 'AI Research',
        reasoning: 'Research task',
      });

      // Set actions agent to fail on next call
      actionsAgentClient.setFailNext(true);

      const usecase = createProcessCommandUseCase({
        commandRepository,
        actionsAgentClient,
        classifierFactory: () => classifier,
        userServiceClient,
        eventPublisher,
        logger,
      });

      const result = await usecase.execute({
        userId,
        sourceType: 'whatsapp_text',
        externalId: 'msg-action-fail',
        text: 'Research AI trends',
        timestamp: '2025-01-01T12:00:00.000Z',
      });

      expect(result.isNew).toBe(true);
      expect(result.command.status).toBe('failed');
      expect(result.command.failureReason).toBe('Actions-agent client error');

      // Verify no action was created
      const actions = actionsAgentClient.getCreatedActions();
      expect(actions).toHaveLength(0);
    });

    it('continues processing when eventPublisher.publishActionCreated fails (line 198)', async () => {
      const userId = 'user-test-publish-fail';
      userServiceClient.setApiKeys(userId, { google: 'google-key' });

      classifier.setResult({
        type: 'todo',
        confidence: 0.9,
        title: 'Test Task',
        reasoning: 'Todo task',
      });

      // Set event publisher to fail on next call
      eventPublisher.setFailNext(true);

      const usecase = createProcessCommandUseCase({
        commandRepository,
        actionsAgentClient,
        classifierFactory: () => classifier,
        userServiceClient,
        eventPublisher,
        logger,
      });

      const result = await usecase.execute({
        userId,
        sourceType: 'whatsapp_text',
        externalId: 'msg-publish-fail',
        text: 'Add item to my list',
        timestamp: '2025-01-01T12:00:00.000Z',
      });

      // Command should still be classified successfully
      expect(result.isNew).toBe(true);
      expect(result.command.status).toBe('classified');
      expect(result.command.classification?.type).toBe('todo');

      // Action was created despite publish failure
      const actions = actionsAgentClient.getCreatedActions();
      expect(actions).toHaveLength(1);

      // No events published due to failure
      const events = eventPublisher.getPublishedEvents();
      expect(events).toHaveLength(0);
    });
  });

  describe('successful paths', () => {
    it('processes new command and creates action for classified type', async () => {
      const userId = 'user-test-success';
      userServiceClient.setApiKeys(userId, { google: 'google-key' });

      classifier.setResult({
        type: 'research',
        confidence: 0.95,
        title: 'AI Research',
        reasoning: 'Research task',
      });

      const usecase = createProcessCommandUseCase({
        commandRepository,
        actionsAgentClient,
        classifierFactory: () => classifier,
        userServiceClient,
        eventPublisher,
        logger,
      });

      const result = await usecase.execute({
        userId,
        sourceType: 'whatsapp_text',
        externalId: 'msg-success',
        text: 'Research AI trends',
        timestamp: '2025-01-01T12:00:00.000Z',
      });

      expect(result.isNew).toBe(true);
      expect(result.command.status).toBe('classified');
      expect(result.command.classification?.type).toBe('research');
      expect(result.command.actionId).toBeDefined();

      const actions = actionsAgentClient.getCreatedActions();
      expect(actions).toHaveLength(1);

      const events = eventPublisher.getPublishedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.actionType).toBe('research');
    });

    it('returns existing command without reprocessing', async () => {
      const userId = 'user-test-existing';
      userServiceClient.setApiKeys(userId, { google: 'google-key' });

      const existingCommand = {
        id: 'whatsapp_text:msg-existing',
        userId,
        sourceType: 'whatsapp_text' as const,
        externalId: 'msg-existing',
        text: 'Existing command',
        timestamp: '2025-01-01T12:00:00.000Z',
        status: 'classified' as const,
        createdAt: '2025-01-01T12:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
        classification: {
          type: 'todo' as const,
          confidence: 0.9,
          reasoning: 'Test',
          classifiedAt: '2025-01-01T12:00:00.000Z',
        },
      };
      commandRepository.addCommand(existingCommand);

      const usecase = createProcessCommandUseCase({
        commandRepository,
        actionsAgentClient,
        classifierFactory: () => classifier,
        userServiceClient,
        eventPublisher,
        logger,
      });

      const result = await usecase.execute({
        userId,
        sourceType: 'whatsapp_text',
        externalId: 'msg-existing',
        text: 'Different text',
        timestamp: '2025-01-01T12:00:01.000Z',
      });

      expect(result.isNew).toBe(false);
      expect(result.command.id).toBe('whatsapp_text:msg-existing');
      expect(result.command.text).toBe('Existing command'); // Original text preserved
    });

    it('creates action for low-confidence note classification', async () => {
      const userId = 'user-test-lowconf';
      userServiceClient.setApiKeys(userId, { google: 'google-key' });

      classifier.setResult({
        type: 'note',
        confidence: 0.3,
        title: 'Unknown',
        reasoning: 'Cannot determine intent, defaulting to note',
      });

      const usecase = createProcessCommandUseCase({
        commandRepository,
        actionsAgentClient,
        classifierFactory: () => classifier,
        userServiceClient,
        eventPublisher,
        logger,
      });

      const result = await usecase.execute({
        userId,
        sourceType: 'whatsapp_text',
        externalId: 'msg-lowconf',
        text: 'Some unclear message',
        timestamp: '2025-01-01T12:00:00.000Z',
      });

      // Now every classification creates an action (note is valid)
      expect(result.isNew).toBe(true);
      expect(result.command.status).toBe('classified');
      expect(result.command.classification?.type).toBe('note');
      expect(result.command.actionId).toBeDefined();

      const actions = actionsAgentClient.getCreatedActions();
      expect(actions).toHaveLength(1);
      expect(actions[0]?.type).toBe('note');

      const events = eventPublisher.getPublishedEvents();
      expect(events).toHaveLength(1);
    });
  });
});
