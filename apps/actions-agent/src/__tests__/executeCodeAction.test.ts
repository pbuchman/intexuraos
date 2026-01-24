import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createExecuteCodeActionUseCase } from '../domain/usecases/executeCodeAction.js';
import type { Action, CodeActionPayload } from '../domain/models/action.js';
import {
  FakeActionRepository,
  FakeCodeAgentClient,
  FakeWhatsAppSendPublisher,
} from './fakes.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('executeCodeAction usecase', () => {
  let fakeActionRepo: FakeActionRepository;
  let fakeCodeClient: FakeCodeAgentClient;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createAction = (overrides: Partial<Action> = {}): Action => ({
    id: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    type: 'code',
    confidence: 0.9,
    title: 'Fix authentication bug',
    status: 'awaiting_approval',
    payload: {
      prompt: 'Fix the login bug',
      workerType: 'auto',
    },
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    fakeActionRepo = new FakeActionRepository();
    fakeCodeClient = new FakeCodeAgentClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns error when action not found', async () => {
    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const result = await usecase('non-existent-action');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe('Action not found');
    }
  });

  it('returns completed status for already completed action with resourceUrl and message', async () => {
    const action = createAction({
      status: 'completed',
      payload: {
        prompt: 'Fix the login bug',
        workerType: 'auto',
        resource_url: 'https://app.intexuraos.com/code-tasks/123',
        message: 'Code task created: code-task-123',
      },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('https://app.intexuraos.com/code-tasks/123');
      expect(result.value.message).toBe('Code task created: code-task-123');
    }
  });

  it('returns error for action with invalid status', async () => {
    const action = createAction({ status: 'processing' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Cannot execute action with status: processing');
    }
  });

  it('processes code action from pending status and updates to completed on success', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('https://app.intexuraos.com/code-tasks/123');
      expect(result.value.message).toContain('code-task-123');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('completed');
    expect(updatedAction?.payload['resource_url']).toBe('https://app.intexuraos.com/code-tasks/123');
    expect(updatedAction?.payload['approvalEventId']).toBeDefined();
  });

  it('processes code action from failed status (retry)', async () => {
    const action = createAction({
      status: 'failed',
      payload: { prompt: 'Fix the login bug', workerType: 'auto', error: 'Previous error' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('completed');
  });

  it('processes code action from awaiting_approval status', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('updates action to failed when code-agent returns 503 worker unavailable', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeCodeClient.setNextError({
      code: 'WORKER_UNAVAILABLE',
      message: 'No workers available',
    });

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('No workers available');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
    expect(updatedAction?.payload['message']).toBe('No workers available');
  });

  it('returns completed status with existing task info when code-agent returns 409 duplicate', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeCodeClient.setNextError({
      code: 'DUPLICATE',
      message: 'Task already exists for this approval',
      existingTaskId: 'existing-task-456',
    });

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.message).toContain('existing-task-456');
    }
  });

  it('updates action to failed when code-agent call fails with network error', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeCodeClient.setFailNext(true);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toContain('Simulated network failure');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
  });

  it('generates unique approvalEventId (UUID format)', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const updatedAction = await fakeActionRepo.getById('action-123');
    const approvalEventId = updatedAction?.payload['approvalEventId'] as string | undefined;

    expect(approvalEventId).toBeDefined();
    expect(approvalEventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('stores resource_url in action payload after successful dispatch', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.payload['resource_url']).toBe('https://app.intexuraos.com/code-tasks/123');
  });

  it('passes correct parameters to code-agent', async () => {
    const action = createAction({
      status: 'pending',
      payload: {
        prompt: 'Fix the login bug',
        workerType: 'opus',
        linearIssueId: 'LIN-123',
      },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const submittedTasks = fakeCodeClient.getSubmittedTasks();
    expect(submittedTasks).toHaveLength(1);
    expect(submittedTasks[0]?.actionId).toBe('action-123');
    expect(submittedTasks[0]?.payload.prompt).toBe('Fix the login bug');
    expect(submittedTasks[0]?.payload.workerType).toBe('opus');
    expect(submittedTasks[0]?.payload.linearIssueId).toBe('LIN-123');
    expect(submittedTasks[0]?.approvalEventId).toBeDefined();
  });

  it('defaults workerType to auto when not specified in payload', async () => {
    const action = createAction({
      status: 'pending',
      payload: {
        prompt: 'Fix the login bug',
      },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const submittedTasks = fakeCodeClient.getSubmittedTasks();
    expect(submittedTasks).toHaveLength(1);
    expect(submittedTasks[0]?.payload.workerType).toBe('auto');
  });

  it('publishes WhatsApp notification on success when resourceUrl exists', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('Code task');
    expect(messages[0]?.message).toContain('https://app.intexuraos.com/code-tasks/123');
    expect(messages[0]?.correlationId).toBe('code-complete-action-123');
  });

  it('succeeds even when WhatsApp notification fails (best-effort)', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = createExecuteCodeActionUseCase({
      actionRepository: fakeActionRepo,
      codeAgentClient: fakeCodeClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.intexuraos.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });
});
