import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createExecuteLinearActionUseCase } from '../domain/usecases/executeLinearAction.js';
import type { Action } from '../domain/models/action.js';
import {
  FakeActionRepository,
  FakeLinearAgentClient,
  FakeWhatsAppSendPublisher,
} from './fakes.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('executeLinearAction usecase', () => {
  let fakeActionRepo: FakeActionRepository;
  let fakeLinearClient: FakeLinearAgentClient;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createAction = (overrides: Partial<Action> = {}): Action => ({
    id: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    type: 'linear',
    confidence: 0.9,
    title: 'Fix authentication bug',
    status: 'awaiting_approval',
    payload: {},
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    fakeActionRepo = new FakeActionRepository();
    fakeLinearClient = new FakeLinearAgentClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns error when action not found', async () => {
    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
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
        resource_url: 'https://linear.app/issue/TEST-123',
        message: 'Linear issue created: TEST-123',
      },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('https://linear.app/issue/TEST-123');
      expect(result.value.message).toBe('Linear issue created: TEST-123');
    }
  });

  it('returns completed status with message when resourceUrl is missing', async () => {
    const action = createAction({
      status: 'completed',
      payload: { message: 'Linear issue created: TEST-456' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBeUndefined();
      expect(result.value.message).toBe('Linear issue created: TEST-456');
    }
  });

  it('returns error for action with invalid status', async () => {
    const action = createAction({ status: 'processing' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Cannot execute action with status: processing');
    }
  });

  it('processes linear action from pending status and updates to completed on success', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('https://linear.app/issue/TEST-123');
      expect(result.value.message).toBe('Linear issue created: TEST-123');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('completed');
    expect(updatedAction?.payload['resource_url']).toBe('https://linear.app/issue/TEST-123');
    expect(updatedAction?.payload['message']).toBe('Linear issue created: TEST-123');
  });

  it('processes linear action from failed status (retry)', async () => {
    const action = createAction({
      status: 'failed',
      payload: { error: 'Previous error' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
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

  it('processes linear action from awaiting_approval status', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('updates action to failed when linear agent returns failed status with error', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeLinearClient.setNextResponse({
      status: 'failed',
      message: 'Invalid Linear issue format',
      errorCode: 'VALIDATION_ERROR',
    });

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Invalid Linear issue format');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
    expect(updatedAction?.payload['message']).toBe('Invalid Linear issue format');
  });

  it('updates action to failed with default error when linear agent returns failed without details', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeLinearClient.setNextResponse({
      status: 'failed',
      message: 'Unknown error',
      errorCode: 'UNKNOWN_ERROR',
    });

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Unknown error');
    }
  });

  it('updates action to failed when linear agent call fails', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeLinearClient.setFailNext(true, new Error('Linear agent unavailable'));

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Linear agent unavailable');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
  });

  it('publishes WhatsApp notification on success when resourceUrl exists', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('Linear issue created: TEST-123');
    expect(messages[0]?.message).toContain('View it here:');
    expect(messages[0]?.message).toContain('https://linear.app/issue/TEST-123');
    expect(messages[0]?.correlationId).toBe('linear-complete-action-123');
  });

  it('does not send WhatsApp notification when resourceUrl is missing', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeLinearClient.setNextResponse({
      status: 'completed',
      message: 'Linear issue created: TEST-456',
    });

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(0);
  });

  it('succeeds even when WhatsApp notification fails (best-effort)', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('passes correct parameters to linear agent', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    await usecase('action-123');

    const processedActions = fakeLinearClient.getProcessedActions();
    expect(processedActions).toHaveLength(1);
    expect(processedActions[0]?.actionId).toBe('action-123');
    expect(processedActions[0]?.userId).toBe('user-456');
    expect(processedActions[0]?.text).toBe('Fix authentication bug');
  });

  it('returns result with message only when resourceUrl is missing', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeLinearClient.setNextResponse({
      status: 'completed',
      message: 'Linear issue created: TEST-789',
    });

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBeUndefined();
      expect(result.value.message).toBe('Linear issue created: TEST-789');
    }
  });

  it('handles resourceUrl with message in WhatsApp notification', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeLinearClient.setNextResponse({
      status: 'completed',
      message: 'Linear issue created: TEST-999',
      resourceUrl: 'https://linear.app/issue/TEST-999',
    });

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('https://linear.app/issue/TEST-999');
      expect(result.value.message).toBe('Linear issue created: TEST-999');
    }

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('Linear issue created: TEST-999');
    expect(messages[0]?.message).toContain('View it here:');
    expect(messages[0]?.message).toContain('https://linear.app/issue/TEST-999');
  });

  it('handles action update to processing before calling linear agent', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    await usecase('action-123');

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('completed');
    expect(updatedAction?.payload['resource_url']).toBeDefined();
  });

  it('passes summary to linear agent when provided in payload', async () => {
    const action = createAction({
      status: 'pending',
      payload: {
        prompt: 'Full issue description...',
        summary: '- Key point 1\n- Key point 2',
      },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteLinearActionUseCase({
      actionRepository: fakeActionRepo,
      linearAgentClient: fakeLinearClient,
      whatsappPublisher: fakeWhatsappPublisher,
      logger: silentLogger,
    });

    await usecase('action-123');

    const processedActions = fakeLinearClient.getProcessedActions();
    expect(processedActions).toHaveLength(1);
    expect(processedActions[0]?.text).toBe('Full issue description...');
    expect(processedActions[0]?.summary).toBe('- Key point 1\n- Key point 2');
  });
});
