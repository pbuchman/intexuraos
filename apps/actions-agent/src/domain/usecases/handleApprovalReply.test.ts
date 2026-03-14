import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { createHandleApprovalReplyUseCase } from './handleApprovalReply.js';
import type { Action } from '../models/action.js';
import type { HandleApprovalReplyDeps, HandleApprovalReplyUseCase } from './handleApprovalReply.js';
import type { ActionRepository, UpdateStatusIfResult } from '../ports/actionRepository.js';
import type { ApprovalMessageRepository } from '../ports/approvalMessageRepository.js';
import type { CodeAgentClient, CancelTaskError, SubmitToPhase2Error } from '../ports/codeAgentClient.js';

// --- Helpers ---

function createFakeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'action-1',
    userId: 'user-1',
    commandId: 'cmd-1',
    type: 'research',
    confidence: 0.9,
    title: 'Test Action',
    status: 'awaiting_approval',
    payload: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createFakeLogger(): HandleApprovalReplyDeps['logger'] {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  } as unknown as HandleApprovalReplyDeps['logger'];
}

function createFakeActionRepository(overrides: Partial<ActionRepository> = {}): ActionRepository {
  return {
    getById: vi.fn<ActionRepository['getById']>().mockResolvedValue(null),
    save: vi.fn<ActionRepository['save']>().mockResolvedValue(undefined),
    update: vi.fn<ActionRepository['update']>().mockResolvedValue(undefined),
    delete: vi.fn<ActionRepository['delete']>().mockResolvedValue(undefined),
    listByUserId: vi.fn<ActionRepository['listByUserId']>().mockResolvedValue([]),
    listByStatus: vi.fn<ActionRepository['listByStatus']>().mockResolvedValue([]),
    updateStatusIf: vi.fn<ActionRepository['updateStatusIf']>().mockResolvedValue({ outcome: 'updated' }),
    ...overrides,
  };
}

function createFakeApprovalMessageRepository(
  overrides: Partial<ApprovalMessageRepository> = {}
): ApprovalMessageRepository {
  return {
    save: vi.fn<ApprovalMessageRepository['save']>().mockResolvedValue(ok(undefined)),
    findByWamid: vi.fn<ApprovalMessageRepository['findByWamid']>().mockResolvedValue(ok(null)),
    deleteByActionId: vi.fn<ApprovalMessageRepository['deleteByActionId']>().mockResolvedValue(ok(undefined)),
    findByActionId: vi.fn<ApprovalMessageRepository['findByActionId']>().mockResolvedValue(ok(null)),
    ...overrides,
  };
}

function createFakeWhatsappPublisher(): HandleApprovalReplyDeps['whatsappPublisher'] {
  return {
    publishSendMessage: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function createFakeActionEventPublisher(): HandleApprovalReplyDeps['actionEventPublisher'] {
  return {
    publishActionCreated: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function createFakeCodeAgentClient(overrides: Partial<CodeAgentClient> = {}): CodeAgentClient {
  return {
    submitTask: vi.fn().mockResolvedValue(ok({ codeTaskId: 'ct-1', resourceUrl: 'https://example.com' })),
    cancelTaskWithNonce: vi.fn().mockResolvedValue(ok({ cancelled: true as const })),
    submitToPhase2: vi.fn().mockResolvedValue(
      ok({ codeTaskId: 'ct-2', resourceUrl: 'https://example.com', workerLocation: 'us', implementationOf: 'task-1' })
    ),
    ...overrides,
  };
}

// --- Tests ---

describe('handleApprovalReply', () => {
  let actionRepository: ActionRepository;
  let approvalMessageRepository: ApprovalMessageRepository;
  let whatsappPublisher: HandleApprovalReplyDeps['whatsappPublisher'];
  let actionEventPublisher: HandleApprovalReplyDeps['actionEventPublisher'];
  let logger: HandleApprovalReplyDeps['logger'];

  beforeEach(() => {
    actionRepository = createFakeActionRepository();
    approvalMessageRepository = createFakeApprovalMessageRepository();
    whatsappPublisher = createFakeWhatsappPublisher();
    actionEventPublisher = createFakeActionEventPublisher();
    logger = createFakeLogger();
  });

  function createUseCase(overrides: Partial<HandleApprovalReplyDeps> = {}): HandleApprovalReplyUseCase {
    return createHandleApprovalReplyUseCase({
      actionRepository,
      approvalMessageRepository,
      whatsappPublisher,
      actionEventPublisher,
      logger,
      ...overrides,
    });
  }

  // ========================================
  // cancel-task button flow (blocks 1, 2)
  // ========================================
  describe('cancel-task button', () => {
    it('succeeds when codeAgentClient cancels task', async () => {
      const codeAgentClient = createFakeCodeAgentClient();
      const handleApprovalReply = createUseCase({ codeAgentClient });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task123:nonce456',
        buttonTitle: 'Cancel Task',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('rejected');
      }
      expect(codeAgentClient.cancelTaskWithNonce).toHaveBeenCalledWith({
        taskId: 'task123',
        nonce: 'nonce456',
        userId: 'user-1',
      });
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('cancellation requested') })
      );
    });

    it('returns error when codeAgentClient is undefined', async () => {
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task123:nonce456',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Code agent client not configured');
      }
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('service temporarily unavailable') })
      );
    });

    it('returns error when nonce is missing', async () => {
      const codeAgentClient = createFakeCodeAgentClient();
      const handleApprovalReply = createUseCase({ codeAgentClient });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Cancel-task button missing nonce');
      }
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('missing security code') })
      );
    });

    it('maps error when cancelTaskWithNonce fails', async () => {
      const cancelError: CancelTaskError = { code: 'TASK_NOT_FOUND', message: 'Not found' };
      const codeAgentClient = createFakeCodeAgentClient({
        cancelTaskWithNonce: vi.fn().mockResolvedValue(err(cancelError)),
      });
      const handleApprovalReply = createUseCase({ codeAgentClient });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task123:nonce456',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('rejected');
      }
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Task not found.' })
      );
    });

    it('sends mapped error message for INVALID_NONCE', async () => {
      const cancelError: CancelTaskError = { code: 'INVALID_NONCE', message: 'bad nonce' };
      const codeAgentClient = createFakeCodeAgentClient({
        cancelTaskWithNonce: vi.fn().mockResolvedValue(err(cancelError)),
      });
      const handleApprovalReply = createUseCase({ codeAgentClient });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task123:nonce456',
      });

      expect(result.ok).toBe(true);
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid cancel code. The code may have already been used.',
        })
      );
    });
  });

  // ========================================
  // proceed-implementation button (blocks 3, 4, 6)
  // ========================================
  describe('proceed-implementation button', () => {
    it('succeeds when submitToPhase2 returns ok', async () => {
      const codeAgentClient = createFakeCodeAgentClient();
      const handleApprovalReply = createUseCase({ codeAgentClient });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('approved');
      }
      expect(codeAgentClient.submitToPhase2).toHaveBeenCalledWith({
        taskId: 'task123',
        userId: 'user-1',
      });
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Starting implementation') })
      );
    });

    it('returns error when codeAgentClient is undefined', async () => {
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Code agent client not configured');
      }
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('service temporarily unavailable') })
      );
    });

    it('maps error and sends WhatsApp notification when submitToPhase2 fails', async () => {
      const phase2Error: SubmitToPhase2Error = { code: 'TASK_NOT_FOUND', message: 'Not found' };
      const codeAgentClient = createFakeCodeAgentClient({
        submitToPhase2: vi.fn().mockResolvedValue(err(phase2Error)),
      });
      const handleApprovalReply = createUseCase({ codeAgentClient });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('rejected');
      }
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Task not found.' })
      );
    });

    it('maps INVALID_STATUS error code correctly', async () => {
      const phase2Error: SubmitToPhase2Error = { code: 'INVALID_STATUS', message: 'bad status' };
      const codeAgentClient = createFakeCodeAgentClient({
        submitToPhase2: vi.fn().mockResolvedValue(err(phase2Error)),
      });
      const handleApprovalReply = createUseCase({ codeAgentClient });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task123',
      });

      expect(result.ok).toBe(true);
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Task is not in designed status. It may have already been implemented.',
        })
      );
    });

    it('logs warning when error notification publish fails', async () => {
      const phase2Error: SubmitToPhase2Error = { code: 'UNKNOWN', message: 'unknown' };
      const codeAgentClient = createFakeCodeAgentClient({
        submitToPhase2: vi.fn().mockResolvedValue(err(phase2Error)),
      });
      whatsappPublisher = {
        publishSendMessage: vi.fn().mockResolvedValue(err(new Error('publish failed'))),
      };
      const handleApprovalReply = createUseCase({ codeAgentClient });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task123',
      });

      expect(result.ok).toBe(true);
    });

    it('logs warning when success notification publish fails', async () => {
      const codeAgentClient = createFakeCodeAgentClient();
      whatsappPublisher = {
        publishSendMessage: vi.fn().mockResolvedValue(err(new Error('publish failed'))),
      };
      const handleApprovalReply = createUseCase({ codeAgentClient });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });

    it('logs warning when codeAgentClient is undefined and publish fails', async () => {
      whatsappPublisher = {
        publishSendMessage: vi.fn().mockResolvedValue(err(new Error('publish failed'))),
      };
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task123',
      });

      expect(result.ok).toBe(false);
    });
  });

  // ========================================
  // Text reply (no button) — re-sends approval buttons
  // ========================================
  describe('text reply without button', () => {
    it('re-sends approval buttons for non-code action', async () => {
      const action = createFakeAction({ type: 'research' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      approvalMessageRepository = createFakeApprovalMessageRepository({
        findByWamid: vi.fn().mockResolvedValue(ok({
          id: 'am-1',
          wamid: 'wamid-1',
          actionId: 'action-1',
          userId: 'user-1',
          sentAt: '2024-01-01T00:00:00.000Z',
          actionType: 'research',
          actionTitle: 'Test Action',
        })),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: 'some text reply',
        userId: 'user-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('unclear_requested_clarification');
      }
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('buttons to approve or reject'),
          buttons: expect.arrayContaining([
            expect.objectContaining({ reply: expect.objectContaining({ title: 'Approve' }) }),
            expect.objectContaining({ reply: expect.objectContaining({ title: 'Reject' }) }),
          ]),
        })
      );
    });

    it('re-sends approval buttons with Convert to Issue for code action', async () => {
      const action = createFakeAction({ type: 'code' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      approvalMessageRepository = createFakeApprovalMessageRepository({
        findByWamid: vi.fn().mockResolvedValue(ok({
          id: 'am-1',
          wamid: 'wamid-1',
          actionId: 'action-1',
          userId: 'user-1',
          sentAt: '2024-01-01T00:00:00.000Z',
          actionType: 'code',
          actionTitle: 'Test Action',
        })),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: 'some text reply',
        userId: 'user-1',
      });

      expect(result.ok).toBe(true);
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          buttons: expect.arrayContaining([
            expect.objectContaining({ reply: expect.objectContaining({ title: 'Convert to Issue' }) }),
          ]),
        })
      );
    });
  });

  // ========================================
  // Button approve flow
  // ========================================
  describe('approve button', () => {
    it('updates status, executes action, cleans up approval message', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const executeResearchAction = vi.fn().mockResolvedValue(ok(undefined));
      const handleApprovalReply = createUseCase({
        executeResearchAction,
      });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.intent).toBe('approve');
        expect(result.value.outcome).toBe('approved');
      }
      expect(actionRepository.updateStatusIf).toHaveBeenCalledWith('action-1', 'pending', 'awaiting_approval');
      expect(executeResearchAction).toHaveBeenCalledWith('action-1');
      expect(approvalMessageRepository.deleteByActionId).toHaveBeenCalledWith('action-1');
    });

    it('handles status_mismatch (race condition)', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({
        getById: vi.fn().mockResolvedValue(action),
        updateStatusIf: vi.fn().mockResolvedValue({ outcome: 'status_mismatch', currentStatus: 'pending' }),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.intent).toBeUndefined();
      }
    });

    it('handles not_found during status update', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({
        getById: vi.fn().mockResolvedValue(action),
        updateStatusIf: vi.fn().mockResolvedValue({ outcome: 'not_found' } as UpdateStatusIfResult),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }
    });

    it('returns error when status update fails', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({
        getById: vi.fn().mockResolvedValue(action),
        updateStatusIf: vi.fn().mockResolvedValue({ outcome: 'error', error: new Error('DB error') } as UpdateStatusIfResult),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to update action status');
      }
    });

    it('logs warning when approval confirmation publish fails', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      whatsappPublisher = {
        publishSendMessage: vi.fn().mockResolvedValue(err(new Error('publish failed'))),
      };
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
    });

    it('logs warning when approval message cleanup fails', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      approvalMessageRepository = createFakeApprovalMessageRepository({
        deleteByActionId: vi.fn().mockResolvedValue(
          err({ code: 'PERSISTENCE_ERROR' as const, message: 'DB error' })
        ),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
    });
  });

  // ========================================
  // Button reject/cancel flow
  // ========================================
  describe('reject button', () => {
    it('rejects the action and sends confirmation', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'reject:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.intent).toBe('reject');
        expect(result.value.outcome).toBe('rejected');
      }
      expect(actionRepository.updateStatusIf).toHaveBeenCalledWith('action-1', 'rejected', 'awaiting_approval');
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Cancelled') })
      );
    });

    it('handles status_mismatch during rejection', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({
        getById: vi.fn().mockResolvedValue(action),
        updateStatusIf: vi.fn().mockResolvedValue({ outcome: 'status_mismatch', currentStatus: 'completed' }),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'reject:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
      }
    });

    it('handles not_found during rejection', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({
        getById: vi.fn().mockResolvedValue(action),
        updateStatusIf: vi.fn().mockResolvedValue({ outcome: 'not_found' } as UpdateStatusIfResult),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'reject:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }
    });

    it('returns error when rejection status update fails', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({
        getById: vi.fn().mockResolvedValue(action),
        updateStatusIf: vi.fn().mockResolvedValue({ outcome: 'error', error: new Error('DB error') } as UpdateStatusIfResult),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'reject:action-1',
      });

      expect(result.ok).toBe(false);
    });

    it('logs warning when rejection confirmation publish fails', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      whatsappPublisher = {
        publishSendMessage: vi.fn().mockResolvedValue(err(new Error('publish failed'))),
      };
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'reject:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }
    });

    it('logs warning when rejection approval message cleanup fails', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      approvalMessageRepository = createFakeApprovalMessageRepository({
        deleteByActionId: vi.fn().mockResolvedValue(
          err({ code: 'PERSISTENCE_ERROR' as const, message: 'DB error' })
        ),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'reject:action-1',
      });

      expect(result.ok).toBe(true);
    });
  });

  // ========================================
  // Convert button
  // ========================================
  describe('convert button', () => {
    it('rejects action and sends convert message', async () => {
      const action = createFakeAction({ type: 'code' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'convert:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.intent).toBe('reject');
        expect(result.value.outcome).toBe('rejected');
      }
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Converting') })
      );
    });
  });

  // ========================================
  // No approval message found
  // ========================================
  describe('approval message lookup', () => {
    it('returns matched: false when no approval message found for wamid', async () => {
      approvalMessageRepository = createFakeApprovalMessageRepository({
        findByWamid: vi.fn().mockResolvedValue(ok(null)),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-unknown',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }
    });

    it('returns error when approval message lookup fails', async () => {
      approvalMessageRepository = createFakeApprovalMessageRepository({
        findByWamid: vi.fn().mockResolvedValue(
          err({ code: 'PERSISTENCE_ERROR' as const, message: 'DB error' })
        ),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to look up approval message');
      }
    });

    it('returns error on user ID mismatch in approval message', async () => {
      approvalMessageRepository = createFakeApprovalMessageRepository({
        findByWamid: vi.fn().mockResolvedValue(ok({
          id: 'am-1',
          wamid: 'wamid-1',
          actionId: 'action-1',
          userId: 'other-user',
          sentAt: '2024-01-01T00:00:00.000Z',
          actionType: 'research' as const,
          actionTitle: 'Test',
        })),
      });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('User ID mismatch');
      }
    });
  });

  // ========================================
  // Action not found
  // ========================================
  describe('action not found', () => {
    it('returns matched: false and notifies user when action not found (via wamid lookup)', async () => {
      approvalMessageRepository = createFakeApprovalMessageRepository({
        findByWamid: vi.fn().mockResolvedValue(ok({
          id: 'am-1',
          wamid: 'wamid-1',
          actionId: 'action-1',
          userId: 'user-1',
          sentAt: '2024-01-01T00:00:00.000Z',
          actionType: 'research' as const,
          actionTitle: 'Test',
        })),
        deleteByActionId: vi.fn().mockResolvedValue(ok(undefined)),
      });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(null) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }
      expect(approvalMessageRepository.deleteByActionId).toHaveBeenCalledWith('action-1');
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('no longer available') })
      );
    });

    it('skips orphan cleanup when actionId was provided directly', async () => {
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(null) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }
      expect(approvalMessageRepository.deleteByActionId).not.toHaveBeenCalled();
    });

    it('logs warning when orphan cleanup fails', async () => {
      approvalMessageRepository = createFakeApprovalMessageRepository({
        findByWamid: vi.fn().mockResolvedValue(ok({
          id: 'am-1',
          wamid: 'wamid-1',
          actionId: 'action-1',
          userId: 'user-1',
          sentAt: '2024-01-01T00:00:00.000Z',
          actionType: 'research' as const,
          actionTitle: 'Test',
        })),
        deleteByActionId: vi.fn().mockResolvedValue(
          err({ code: 'PERSISTENCE_ERROR' as const, message: 'DB error' })
        ),
      });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(null) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(true);
    });
  });

  // ========================================
  // Action in terminal state
  // ========================================
  describe('terminal state', () => {
    it('returns matched: true without processing for completed action', async () => {
      const action = createFakeAction({ status: 'completed' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.actionId).toBe('action-1');
        expect(result.value.intent).toBeUndefined();
      }
    });

    it('returns matched: true without processing for rejected action', async () => {
      const action = createFakeAction({ status: 'rejected' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
      }
      expect(actionRepository.updateStatusIf).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // User ID mismatch on action
  // ========================================
  describe('action user mismatch', () => {
    it('returns error when action userId does not match', async () => {
      const action = createFakeAction({ userId: 'other-user' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('User ID mismatch');
      }
    });
  });

  // ========================================
  // Invalid button ID format
  // ========================================
  describe('invalid button ID', () => {
    it('returns error for button ID with no colon separator', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'nocolon',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Invalid button ID format');
      }
    });

    it('returns error for button action ID mismatch', async () => {
      const action = createFakeAction({ id: 'action-1' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-wrong',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Button action ID mismatch');
      }
    });

    it('returns error for unknown button intent', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'unknownintent:action-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Unknown button intent');
      }
    });
  });

  // ========================================
  // executeActionByType flows
  // ========================================
  describe('executeActionByType', () => {
    it('executes note action after approval', async () => {
      const action = createFakeAction({ type: 'note' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const executeNoteAction = vi.fn().mockResolvedValue(ok(undefined));
      const handleApprovalReply = createUseCase({ executeNoteAction });

      await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(executeNoteAction).toHaveBeenCalledWith('action-1');
    });

    it('executes todo action after approval', async () => {
      const action = createFakeAction({ type: 'todo' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const executeTodoAction = vi.fn().mockResolvedValue(ok(undefined));
      const handleApprovalReply = createUseCase({ executeTodoAction });

      await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(executeTodoAction).toHaveBeenCalledWith('action-1');
    });

    it('executes link action after approval', async () => {
      const action = createFakeAction({ type: 'link' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const executeLinkAction = vi.fn().mockResolvedValue(ok(undefined));
      const handleApprovalReply = createUseCase({ executeLinkAction });

      await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(executeLinkAction).toHaveBeenCalledWith('action-1');
    });

    it('executes calendar action after approval', async () => {
      const action = createFakeAction({ type: 'calendar' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const executeCalendarAction = vi.fn().mockResolvedValue(ok(undefined));
      const handleApprovalReply = createUseCase({ executeCalendarAction });

      await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(executeCalendarAction).toHaveBeenCalledWith('action-1');
    });

    it('executes linear action after approval', async () => {
      const action = createFakeAction({ type: 'linear' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const executeLinearAction = vi.fn().mockResolvedValue(ok(undefined));
      const handleApprovalReply = createUseCase({ executeLinearAction });

      await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(executeLinearAction).toHaveBeenCalledWith('action-1');
    });

    it('executes code action after approval', async () => {
      const action = createFakeAction({ type: 'code' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const executeCodeAction = vi.fn().mockResolvedValue(ok(undefined));
      const handleApprovalReply = createUseCase({ executeCodeAction });

      await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(executeCodeAction).toHaveBeenCalledWith('action-1');
    });

    it('falls back to event publishing when executor is not provided', async () => {
      const action = createFakeAction({ type: 'research' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      // Do NOT provide executeResearchAction
      const handleApprovalReply = createUseCase();

      await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(actionEventPublisher.publishActionCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'action.created',
          actionId: 'action-1',
          actionType: 'research',
        })
      );
    });

    it('falls back to event publishing for reminder action type', async () => {
      const action = createFakeAction({ type: 'reminder' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const handleApprovalReply = createUseCase();

      await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(actionEventPublisher.publishActionCreated).toHaveBeenCalled();
    });

    it('logs error when action executor fails', async () => {
      const action = createFakeAction({ type: 'note' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const executeNoteAction = vi.fn().mockResolvedValue(err(new Error('Execution failed')));
      const handleApprovalReply = createUseCase({ executeNoteAction });

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      // The approval still succeeds even if execution fails
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });

    it('logs error when event publish fails', async () => {
      const action = createFakeAction({ type: 'research' });
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      actionEventPublisher = {
        publishActionCreated: vi.fn().mockResolvedValue(err(new Error('Publish failed'))),
      };
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
    });
  });

  // ========================================
  // cancel button (via handleButtonResponse)
  // ========================================
  describe('cancel button', () => {
    it('cancels the action and sends cancellation message', async () => {
      const action = createFakeAction();
      actionRepository = createFakeActionRepository({ getById: vi.fn().mockResolvedValue(action) });
      const handleApprovalReply = createUseCase();

      const result = await handleApprovalReply({
        replyToWamid: 'wamid-1',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'cancel:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.intent).toBe('reject');
        expect(result.value.outcome).toBe('rejected');
      }
      expect(whatsappPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Cancelled') })
      );
    });
  });
});
