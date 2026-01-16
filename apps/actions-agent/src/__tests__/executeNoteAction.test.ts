import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import { createExecuteNoteActionUseCase } from '../domain/usecases/executeNoteAction.js';
import type { Action } from '../domain/models/action.js';
import {
  FakeActionRepository,
  FakeNotesServiceClient,
  FakeWhatsAppSendPublisher,
} from './fakes.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('executeNoteAction usecase', () => {
  let fakeActionRepo: FakeActionRepository;
  let fakeNotesClient: FakeNotesServiceClient;
  let fakeWhatsappPublisher: FakeWhatsAppSendPublisher;

  const createAction = (overrides: Partial<Action> = {}): Action => ({
    id: 'action-123',
    userId: 'user-456',
    commandId: 'cmd-789',
    type: 'note',
    confidence: 0.85,
    title: 'Meeting notes',
    status: 'awaiting_approval',
    payload: {},
    createdAt: '2025-01-01T12:00:00.000Z',
    updatedAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    fakeActionRepo = new FakeActionRepository();
    fakeNotesClient = new FakeNotesServiceClient();
    fakeWhatsappPublisher = new FakeWhatsAppSendPublisher();
  });

  it('returns error when action not found', async () => {
    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
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
      payload: { resource_url: '/#/notes/existing-note' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resource_url).toBe('/#/notes/existing-note');
    }
  });

  it('returns error for action with invalid status', async () => {
    const action = createAction({ status: 'processing' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
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

  it('creates note and updates action to completed on success', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: { prompt: 'Discussed quarterly goals' },
    });
    await fakeActionRepo.save(action);
    fakeNotesClient.setNextNoteId('note-new-123');

    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('completed');
      expect(result.value.resource_url).toBe('/#/notes/note-new-123');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('completed');
    expect(updatedAction?.payload['noteId']).toBe('note-new-123');
  });

  it('updates action to failed when note creation fails', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeNotesClient.setFailNext(true, new Error('Notes service unavailable'));

    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    const result = await usecase('action-123');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe('failed');
      expect(result.value.error).toBe('Notes service unavailable');
    }

    const updatedAction = await fakeActionRepo.getById('action-123');
    expect(updatedAction?.status).toBe('failed');
  });

  it('allows execution from failed status (retry)', async () => {
    const action = createAction({ status: 'failed' });
    await fakeActionRepo.save(action);
    fakeNotesClient.setNextNoteId('retry-note-123');

    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
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
    fakeNotesClient.setNextNoteId('notified-note-123');

    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.userId).toBe('user-456');
    expect(messages[0]?.message).toContain('Note created');
    expect(messages[0]?.message).toContain('https://app.test.com/#/notes/notified-note-123');
  });

  it('succeeds even when WhatsApp notification fails (best-effort)', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);
    fakeWhatsappPublisher.setFailNext(true, {
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp unavailable',
    });

    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
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

  it('passes correct parameters to notes service', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: { prompt: 'Discussed quarterly goals' },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const createdNotes = fakeNotesClient.getCreatedNotes();
    expect(createdNotes).toHaveLength(1);
    expect(createdNotes[0]).toEqual({
      userId: 'user-456',
      title: 'Meeting notes',
      content: 'Discussed quarterly goals',
      tags: [],
      source: 'actions-agent',
      sourceId: 'action-123',
    });
  });

  it('uses title as content when payload.prompt is not provided', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: {},
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const createdNotes = fakeNotesClient.getCreatedNotes();
    expect(createdNotes).toHaveLength(1);
    expect(createdNotes[0]?.content).toBe('Meeting notes');
  });

  it('prepends Key Points section when summary is provided', async () => {
    const action = createAction({
      status: 'awaiting_approval',
      payload: {
        prompt: 'Full meeting transcript here...',
        summary: '- Discussed Q4 goals\n- Action items assigned',
      },
    });
    await fakeActionRepo.save(action);

    const usecase = createExecuteNoteActionUseCase({
      actionRepository: fakeActionRepo,
      notesServiceClient: fakeNotesClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: silentLogger,
    });

    await usecase('action-123');

    const createdNotes = fakeNotesClient.getCreatedNotes();
    expect(createdNotes).toHaveLength(1);
    expect(createdNotes[0]?.content).toBe(
      '## Key Points\n\n- Discussed Q4 goals\n- Action items assigned\n\n---\n\nFull meeting transcript here...'
    );
  });
});
