import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createExecuteTodoActionUseCase } from '../domain/usecases/executeTodoAction.js';
import type { Action } from '../domain/models/action.js';
import {
  FakeActionRepository,
  FakeTodosServiceClient,
  FakeWhatsAppSendPublisher,
} from './fakes.js';

import { createMockLogger } from './fakes.js';

describe('executeTodoAction usecase', () => {
  let fakeActionRepo: FakeActionRepository;
  let fakeTodosClient: FakeTodosServiceClient;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createAction = (overrides: Partial<Action> = {}): Action => ({
    id: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    type: 'todo',
    confidence: 0.9,
    title: 'Buy groceries',
    status: 'awaiting_approval',
    payload: {},
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    fakeActionRepo = new FakeActionRepository();
    fakeTodosClient = new FakeTodosServiceClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns error when action not found', async () => {
    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    const result = await usecase('non-existent-action');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toBe('Action not found');
    }
  });

  it('returns completed status for already completed action', async () => {
    const action = createAction({
      status: 'completed',
      payload: { resource_url: '/#/todos/existing-todo' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('/#/todos/existing-todo');
    }
  });

  it('returns error for action with invalid status', async () => {
    const action = createAction({ status: 'processing' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Cannot execute action with status');
    }
  });

  it('creates todo and updates action to completed on success', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: { prompt: 'Milk, eggs, bread' },
    });
    await fakeActionRepo.save(action);
    fakeTodosClient.setNextResponse({
      status: 'completed',
      message: 'Todo created successfully',
      resourceUrl: '/#/todos/todo-new-123',
    });

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('/#/todos/todo-new-123');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('completed');
    expect(updatedAction?.payload['resource_url']).toBe('/#/todos/todo-new-123');
  });

  it('updates action to failed when todo creation fails', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeTodosClient.setFailNext(true, new Error('Todos service unavailable'));

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Todos service unavailable');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
  });

  it('handles failed response status with error code', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeTodosClient.setNextResponse({
      status: 'failed',
      message: 'Item extraction failed',
      errorCode: 'EXTRACTION_FAILED',
    });

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Item extraction failed');
      expect(result.value.errorCode).toBe('EXTRACTION_FAILED');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
    expect(updatedAction?.payload['errorCode']).toBe('EXTRACTION_FAILED');
  });

  it('allows execution from failed status (retry)', async () => {
    const action = createAction({ status: 'failed' });
    await fakeActionRepo.save(action);
    fakeTodosClient.setNextResponse({
      status: 'completed',
      message: 'Todo created successfully',
      resourceUrl: '/#/todos/retry-todo-123',
    });

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('publishes WhatsApp notification on success', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeTodosClient.setNextResponse({
      status: 'completed',
      message: 'Todo created successfully',
      resourceUrl: '/#/todos/notified-todo-123',
    });

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('Todo created');
    expect(messages[0]?.message).toContain('https://app.test.com/#/todos/notified-todo-123');
  });

  it('succeeds even when WhatsApp notification fails (best-effort)', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('passes correct parameters to todos service', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: { prompt: 'Milk, eggs, bread' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const createdTodos = fakeTodosClient.getCreatedTodos();
    expect(createdTodos).toHaveLength(1);
    expect(createdTodos[0]).toEqual({
      userId: 'user-456',
      title: 'Buy groceries',
      description: 'Milk, eggs, bread',
      tags: [],
      source: 'actions-agent',
      sourceId: 'action-123',
    });
  });

  it('returns completed status with message from payload for already completed action', async () => {
    const action = createAction({
      status: 'completed',
      payload: {
        resource_url: '/#/todos/existing-todo',
        message: 'Previously created todo',
      },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.message).toBe('Previously created todo');
      expect(result.value.resourceUrl).toBe('/#/todos/existing-todo');
    }
  });

  it('allows execution from pending status', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);
    fakeTodosClient.setNextResponse({
      status: 'completed',
      message: 'Todo created successfully',
      resourceUrl: '/#/todos/pending-todo-123',
    });

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('does not send WhatsApp notification when resourceUrl is missing', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeTodosClient.setNextResponse({
      status: 'completed',
      message: 'Todo created',
    });

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(0);
  });

  it('uses title as description when payload.prompt is not provided', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: {},
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteTodoActionUseCase({
      actionRepository: fakeActionRepo,
      todosServiceClient: fakeTodosClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const createdTodos = fakeTodosClient.getCreatedTodos();
    expect(createdTodos).toHaveLength(1);
    expect(createdTodos[0]?.description).toBe('Buy groceries');
  });
});
