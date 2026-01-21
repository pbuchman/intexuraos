import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createExecuteResearchActionUseCase } from '../domain/usecases/executeResearchAction.js';
import type { Action } from '../domain/models/action.js';
import {
  FakeActionRepository,
  FakeResearchServiceClient,
  FakeWhatsAppSendPublisher,
} from './fakes.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('executeResearchAction usecase', () => {
  let fakeActionRepo: FakeActionRepository;
  let fakeResearchClient: FakeResearchServiceClient;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createAction = (overrides: Partial<Action> = {}): Action => ({
    id: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    type: 'research',
    confidence: 0.95,
    title: 'Test Research',
    status: 'awaiting_approval',
    payload: {},
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    fakeActionRepo = new FakeActionRepository();
    fakeResearchClient = new FakeResearchServiceClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns error when action not found', async () => {
    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
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
      payload: { resource_url: '/#/research/existing' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('/#/research/existing');
    }
  });

  it('returns error for action with invalid status', async () => {
    const action = createAction({ status: 'processing' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Cannot execute action with status');
    }
  });

  it('executes research and updates action to completed on success', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeResearchClient.setNextResponse({
      status: 'completed',
      message: 'Research draft created successfully',
      resourceUrl: '/#/research/research-new-123',
    });

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resourceUrl).toBe('/#/research/research-new-123');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('completed');
    expect(updatedAction?.payload['resource_url']).toBe('/#/research/research-new-123');
  });

  it('updates action to failed when research creation fails', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeResearchClient.setFailNext(true, new Error('Research service unavailable'));

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Research service unavailable');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
  });

  it('handles failed response status with error code', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeResearchClient.setNextResponse({
      status: 'failed',
      message: 'Context inference failed',
      errorCode: 'EXTRACTION_FAILED',
    });

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.message).toBe('Context inference failed');
      expect(result.value.errorCode).toBe('EXTRACTION_FAILED');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
    expect(updatedAction?.payload['errorCode']).toBe('EXTRACTION_FAILED');
  });

  it('allows execution from failed status (retry)', async () => {
    const action = createAction({ status: 'failed' });
    await fakeActionRepo.save(action);
    fakeResearchClient.setNextResponse({
      status: 'completed',
      message: 'Research draft created successfully',
      resourceUrl: '/#/research/retry-research-123',
    });

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
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
    fakeResearchClient.setNextResponse({
      status: 'completed',
      message: 'Research draft created successfully',
      resourceUrl: '/#/research/notified-research-123',
    });

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('Research draft created successfully');
    expect(messages[0]?.message).toContain('View it here:');
    expect(messages[0]?.message).toContain('https://app.test.com/#/research/notified-research-123');
  });

  it('succeeds even when WhatsApp notification fails (best-effort)', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('uses payload.prompt as research prompt when available', async () => {
    const originalMessage = 'This is the full original message from WhatsApp';
    const action = createAction({
      status: 'awaiting_approval',
      payload: { prompt: originalMessage },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const params = fakeResearchClient.getLastCreateDraftParams();
    expect(params?.prompt).toBe(originalMessage);
    expect(params?.title).toBe('Test Research');
  });

  it('falls back to title when payload.prompt is missing', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: {},
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const params = fakeResearchClient.getLastCreateDraftParams();
    expect(params?.prompt).toBe('Test Research');
  });

  it('prepends Key Points section when summary is provided', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: {
        prompt: 'Full research question context...',
        summary: '- Main topic A\n- Main topic B',
      },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const params = fakeResearchClient.getLastCreateDraftParams();
    expect(params?.prompt).toBe(
      '## Key Points\n\n- Main topic A\n- Main topic B\n\n---\n\nFull research question context...'
    );
  });

  it('returns completed status with message from payload for already completed action', async () => {
    const action = createAction({
      status: 'completed',
      payload: {
        resource_url: '/#/research/existing',
        message: 'Previously created research',
      },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.message).toBe('Previously created research');
      expect(result.value.resourceUrl).toBe('/#/research/existing');
    }
  });

  it('returns error for action with pending status', async () => {
    const action = createAction({ status: 'pending' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Cannot execute action with status: pending');
    }
  });

  it('does not send WhatsApp notification when resourceUrl is missing', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeResearchClient.setNextResponse({
      status: 'completed',
      message: 'Research draft created',
    });

    const usecase = createExecuteResearchActionUseCase({
      actionRepository: fakeActionRepo,
      researchServiceClient: fakeResearchClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(0);
  });
});
