import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHandleApprovalReplyUseCase } from '../../domain/usecases/handleApprovalReply.js';
import type { HandleApprovalReplyUseCase } from '../../domain/usecases/handleApprovalReply.js';
import {
  FakeActionRepository,
  FakeApprovalMessageRepository,
  FakeWhatsAppSendPublisher,
  FakeActionEventPublisher,
} from '../fakes.js';
import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Action } from '../../domain/models/action.js';
import type { ApprovalMessage } from '../../domain/models/approvalMessage.js';

const createMockLogger = (): Logger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: 'silent',
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    msgPrefix: '',
  }) as unknown as Logger;

describe('HandleApprovalReplyUseCase', () => {
  let actionRepository: FakeActionRepository;
  let approvalMessageRepository: FakeApprovalMessageRepository;
  let whatsappPublisher: FakeWhatsAppSendPublisher;
  let actionEventPublisher: FakeActionEventPublisher;
  let useCase: HandleApprovalReplyUseCase;

  const testAction: Action = {
    id: 'action-1',
    userId: 'user-1',
    commandId: 'cmd-1',
    type: 'todo',
    confidence: 0.85,
    title: 'Test todo action',
    status: 'awaiting_approval',
    payload: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const testApprovalMessage: ApprovalMessage = {
    id: 'approval-msg-1',
    wamid: 'wamid-123',
    actionId: 'action-1',
    actionType: 'todo',
    actionTitle: 'Test todo action',
    userId: 'user-1',
    sentAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    actionRepository = new FakeActionRepository();
    approvalMessageRepository = new FakeApprovalMessageRepository();
    whatsappPublisher = new FakeWhatsAppSendPublisher();
    actionEventPublisher = new FakeActionEventPublisher();

    useCase = createHandleApprovalReplyUseCase({
      actionRepository,
      approvalMessageRepository,
      whatsappPublisher,
      actionEventPublisher,
      logger: createMockLogger(),
      webAppUrl: 'https://test.intexuraos.cloud',
    });
  });

  describe('approval message lookup', () => {
    it('returns error when approval message lookup fails', async () => {
      approvalMessageRepository.setFailNext(true, {
        code: 'PERSISTENCE_ERROR',
        message: 'Database connection failed',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to look up approval message');
      }
    });

    it('returns matched: false when no approval message found', async () => {
      const result = await useCase({
        replyToWamid: 'wamid-unknown',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }
    });

    it('returns error when user ID mismatch on approval message', async () => {
      approvalMessageRepository.setMessage({
        ...testApprovalMessage,
        userId: 'different-user',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('User ID mismatch');
      }
    });
  });

  describe('action lookup', () => {
    it('returns ok with matched false and sends WhatsApp notification when action not found', async () => {
      approvalMessageRepository.setMessage(testApprovalMessage);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }

      const sentMessages = whatsappPublisher.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.message).toContain('no longer available');
      expect(sentMessages[0]?.userId).toBe('user-1');
    });

    it('cleans up orphaned approval message when action not found via wamid lookup', async () => {
      approvalMessageRepository.setMessage(testApprovalMessage);

      await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
      });

      const messages = approvalMessageRepository.getMessages();
      expect(messages).toHaveLength(0);
    });

    it('does not clean up approval message when action ID was provided directly', async () => {
      approvalMessageRepository.setMessage(testApprovalMessage);

      await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      const messages = approvalMessageRepository.getMessages();
      expect(messages).toHaveLength(1);
    });

    it('sends WhatsApp notification even when cleanup of orphaned approval message fails', async () => {
      approvalMessageRepository.setMessage(testApprovalMessage);

      vi.spyOn(approvalMessageRepository, 'deleteByActionId').mockImplementationOnce(
        async () => err({ code: 'PERSISTENCE_ERROR', message: 'Failed to delete' })
      );

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }

      const sentMessages = whatsappPublisher.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.message).toContain('no longer available');
    });

    it('returns error when user ID mismatch on action', async () => {
      await actionRepository.save({
        ...testAction,
        userId: 'different-user',
      });
      approvalMessageRepository.setMessage({
        ...testApprovalMessage,
        userId: 'user-1',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
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

  describe('action status check', () => {
    it('returns early when action is in completed terminal state', async () => {
      await actionRepository.save({
        ...testAction,
        status: 'completed',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.actionId).toBe('action-1');
        expect(result.value.intent).toBeUndefined();
        expect(result.value.outcome).toBeUndefined();
      }
    });

    it('returns early when action is in rejected terminal state', async () => {
      await actionRepository.save({
        ...testAction,
        status: 'rejected',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.actionId).toBe('action-1');
        expect(result.value.intent).toBeUndefined();
        expect(result.value.outcome).toBeUndefined();
      }
    });
  });

  describe('text reply re-sends buttons', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
    });

    it('re-sends approval buttons when text reply received (non-code action)', async () => {
      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes please',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.actionId).toBe('action-1');
        expect(result.value.outcome).toBe('unclear_requested_clarification');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('buttons');
      expect(messages[0]?.buttons).toBeDefined();
      expect(messages[0]?.buttons).toHaveLength(2);

      const buttonIds = messages[0]?.buttons?.map((b) => b.reply.id);
      expect(buttonIds).toContain('approve:action-1');
      expect(buttonIds).toContain('reject:action-1');
    });

    it('re-sends approval buttons with convert option for code actions', async () => {
      const codeAction: Action = {
        ...testAction,
        id: 'code-action-resend',
        type: 'code',
      };
      await actionRepository.save(codeAction);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'hmm maybe',
        userId: 'user-1',
        actionId: 'code-action-resend',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('unclear_requested_clarification');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.buttons).toHaveLength(3);

      const buttonIds = messages[0]?.buttons?.map((b) => b.reply.id);
      expect(buttonIds).toContain('approve:code-action-resend');
      expect(buttonIds).toContain('reject:code-action-resend');
      expect(buttonIds).toContain('convert:code-action-resend');
    });

    it('does not change action status for text replies', async () => {
      await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('awaiting_approval');
    });

    it('proceeds with text reply for pending action (not terminal)', async () => {
      await actionRepository.save({
        ...testAction,
        status: 'pending',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('unclear_requested_clarification');
      }
    });
  });

  describe('button response handling', () => {
    describe('approve button', () => {
      it('approves action when approve button clicked', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
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

        const action = await actionRepository.getById('action-1');
        expect(action?.status).toBe('pending');

        const messages = whatsappPublisher.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Approved!');
        expect(messages[0]?.message).toContain('todo');
      });

      it('returns error for invalid button ID format', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'invalid-format',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('Invalid button ID format');
        }
      });

      it('returns error when button action ID does not match action ID', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'approve:different-action',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('Button action ID mismatch');
        }
      });

      it('returns unknown button intent for unrecognized intent', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'unknown-intent:action-1',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('Unknown button intent');
        }
      });
    });

    describe('reject button', () => {
      it('rejects action when reject button is clicked', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
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

        const action = await actionRepository.getById('action-1');
        expect(action?.status).toBe('rejected');

        const messages = whatsappPublisher.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Got it. Cancelled the');
      });
    });

    describe('cancel button', () => {
      it('rejects action when cancel button is clicked', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'cancel:action-1',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.outcome).toBe('rejected');
        }

        const action = await actionRepository.getById('action-1');
        expect(action?.status).toBe('rejected');

        const messages = whatsappPublisher.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Cancelled');
      });
    });

    describe('convert button', () => {
      it('rejects action with conversion message when convert button is clicked', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'convert:action-1',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.outcome).toBe('rejected');
        }

        const action = await actionRepository.getById('action-1');
        expect(action?.status).toBe('rejected');

        const messages = whatsappPublisher.getSentMessages();
        const convertMessage = messages.find((m) => m.message.includes('Converting'));
        expect(convertMessage?.message).toContain('Converting todo to Linear issue');
      });
    });
  });

  describe('race condition prevention (atomic status updates)', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
    });

    it('prevents duplicate approval when status already changed (race condition)', async () => {
      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'status_mismatch',
        currentStatus: 'pending',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.actionId).toBe('action-1');
        expect(result.value.intent).toBeUndefined();
        expect(result.value.outcome).toBeUndefined();
      }

      expect(whatsappPublisher.getSentMessages()).toHaveLength(0);
    });

    it('prevents duplicate rejection when status already changed (race condition)', async () => {
      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'status_mismatch',
        currentStatus: 'pending',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'cancel:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.actionId).toBe('action-1');
        expect(result.value.intent).toBeUndefined();
        expect(result.value.outcome).toBeUndefined();
      }

      expect(whatsappPublisher.getSentMessages()).toHaveLength(0);
    });

    it('acks and sends WhatsApp notification when action not found during approval update', async () => {
      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'not_found',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }

      const sentMessages = whatsappPublisher.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.message).toContain('no longer available');
    });

    it('acks and sends WhatsApp notification when action not found during rejection update', async () => {
      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'not_found',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'cancel:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }

      const sentMessages = whatsappPublisher.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.message).toContain('no longer available');
    });

    it('returns error when update fails during approval', async () => {
      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'error',
        error: new Error('Firestore transaction failed'),
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
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

    it('returns error when update fails during rejection', async () => {
      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'error',
        error: new Error('Firestore transaction failed'),
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'cancel:action-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to update action status');
      }
    });
  });

  describe('approval message cleanup', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
      approvalMessageRepository.setMessage(testApprovalMessage);
    });

    it('cleans up approval message after button approval', async () => {
      await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      const messages = approvalMessageRepository.getMessages();
      expect(messages).toHaveLength(0);
    });

    it('cleans up approval message after button rejection', async () => {
      await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'cancel:action-1',
      });

      const messages = approvalMessageRepository.getMessages();
      expect(messages).toHaveLength(0);
    });
  });

  describe('WhatsApp publish failures', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
    });

    it('handles publish failure for approval confirmation silently', async () => {
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('pending');
    });

    it('handles publish failure for rejection confirmation silently', async () => {
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'cancel:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }

      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('rejected');
    });
  });

  describe('approval message cleanup failures', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
      approvalMessageRepository.setMessage(testApprovalMessage);
    });

    it('logs warning when cleanup fails after approval but still succeeds', async () => {
      vi.spyOn(approvalMessageRepository, 'deleteByActionId').mockResolvedValueOnce(
        err({ code: 'PERSISTENCE_ERROR', message: 'Cleanup failed' })
      );

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });

    it('logs warning when cleanup fails after rejection but still succeeds', async () => {
      vi.spyOn(approvalMessageRepository, 'deleteByActionId').mockResolvedValueOnce(
        err({ code: 'PERSISTENCE_ERROR', message: 'Cleanup failed' })
      );

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'cancel:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }
    });
  });

  describe('actionId provided directly', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
    });

    it('uses provided actionId directly without wamid lookup', async () => {
      const result = await useCase({
        replyToWamid: 'wamid-unused',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.actionId).toBe('action-1');
        expect(result.value.outcome).toBe('approved');
      }
    });
  });

  describe('note action execution after approval', () => {
    it('calls executeNoteAction directly when approving a note action via button', async () => {
      const noteAction: Action = {
        id: 'note-action-1',
        userId: 'user-1',
        commandId: 'cmd-1',
        type: 'note',
        confidence: 0.85,
        title: 'Test note action',
        status: 'awaiting_approval',
        payload: { prompt: 'Original prompt content' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      await actionRepository.save(noteAction);

      const executeNoteActionCalls: string[] = [];
      const mockExecuteNoteAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeNoteActionCalls.push(actionId);
        return ok({ status: 'completed' as const, message: 'Note created!' });
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeNoteAction: mockExecuteNoteAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'note-action-1',
        buttonId: 'approve:note-action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      expect(executeNoteActionCalls).toHaveLength(1);
      expect(executeNoteActionCalls[0]).toBe('note-action-1');
      expect(actionEventPublisher.getPublishedEvents()).toHaveLength(0);
    });

    it('falls back to publishing event when executeNoteAction is not provided', async () => {
      const noteAction: Action = {
        id: 'note-action-2',
        userId: 'user-1',
        commandId: 'cmd-1',
        type: 'note',
        confidence: 0.85,
        title: 'Test note action',
        status: 'awaiting_approval',
        payload: { prompt: 'Original prompt content' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      await actionRepository.save(noteAction);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'note-action-2',
        buttonId: 'approve:note-action-2',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
    });

    it('logs error when executeNoteAction returns error result', async () => {
      const noteAction: Action = {
        id: 'note-action-error',
        userId: 'user-1',
        commandId: 'cmd-1',
        type: 'note',
        confidence: 0.85,
        title: 'Test note action that will fail',
        status: 'awaiting_approval',
        payload: { prompt: 'Original prompt content' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      await actionRepository.save(noteAction);

      const executeCalls: string[] = [];
      const mockExecuteNoteAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeCalls.push(actionId);
        return err(new Error('Failed to create note'));
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeNoteAction: mockExecuteNoteAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'note-action-error',
        buttonId: 'approve:note-action-error',
      });

      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toBe('note-action-error');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });
  });

  describe('todo action execution after approval', () => {
    it('calls executeTodoAction directly when approving via button', async () => {
      const todoAction: Action = {
        id: 'todo-action-1',
        type: 'todo',
        userId: 'user-1',
        title: 'Test todo',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(todoAction);

      const executeCalls: string[] = [];
      const mockExecuteTodoAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeCalls.push(actionId);
        return ok({ status: 'completed' as const, message: 'Todo created!' });
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeTodoAction: mockExecuteTodoAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'todo-action-1',
        buttonId: 'approve:todo-action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toBe('todo-action-1');
      expect(actionEventPublisher.getPublishedEvents()).toHaveLength(0);
    });

    it('falls back to publishing event when executeTodoAction is not provided', async () => {
      const todoAction: Action = {
        id: 'todo-action-2',
        type: 'todo',
        userId: 'user-1',
        title: 'Test todo',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(todoAction);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'todo-action-2',
        buttonId: 'approve:todo-action-2',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('todo');
    });

    it('logs error when executeTodoAction returns error result', async () => {
      const todoAction: Action = {
        id: 'todo-action-error',
        type: 'todo',
        userId: 'user-1',
        title: 'Test todo that will fail',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(todoAction);

      const executeCalls: string[] = [];
      const mockExecuteTodoAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeCalls.push(actionId);
        return err(new Error('Failed to create todo'));
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeTodoAction: mockExecuteTodoAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'todo-action-error',
        buttonId: 'approve:todo-action-error',
      });

      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toBe('todo-action-error');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });
  });

  describe('research action execution after approval', () => {
    it('calls executeResearchAction directly when approving via button', async () => {
      const researchAction: Action = {
        id: 'research-action-1',
        type: 'research',
        userId: 'user-1',
        title: 'Test research',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(researchAction);

      const executeCalls: string[] = [];
      const mockExecuteResearchAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeCalls.push(actionId);
        return ok({ status: 'completed' as const, message: 'Research created!' });
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeResearchAction: mockExecuteResearchAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'research-action-1',
        buttonId: 'approve:research-action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toBe('research-action-1');
      expect(actionEventPublisher.getPublishedEvents()).toHaveLength(0);
    });

    it('falls back to publishing event when executeResearchAction is not provided', async () => {
      const researchAction: Action = {
        id: 'research-action-2',
        type: 'research',
        userId: 'user-1',
        title: 'Test research',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(researchAction);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'research-action-2',
        buttonId: 'approve:research-action-2',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('research');
    });

    it('logs error when executeResearchAction returns error result', async () => {
      const researchAction: Action = {
        id: 'research-action-error',
        type: 'research',
        userId: 'user-1',
        title: 'Test research that will fail',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(researchAction);

      const executeCalls: string[] = [];
      const mockExecuteResearchAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeCalls.push(actionId);
        return err(new Error('Failed to create research'));
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeResearchAction: mockExecuteResearchAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'research-action-error',
        buttonId: 'approve:research-action-error',
      });

      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toBe('research-action-error');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });
  });

  describe('link action execution after approval', () => {
    it('calls executeLinkAction directly when approving via button', async () => {
      const linkAction: Action = {
        id: 'link-action-2',
        type: 'link',
        userId: 'user-1',
        title: 'Test link',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(linkAction);

      const executeCalls: string[] = [];
      const mockExecuteLinkAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeCalls.push(actionId);
        return ok({ status: 'completed' as const, message: 'Link saved!' });
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeLinkAction: mockExecuteLinkAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'link-action-2',
        buttonId: 'approve:link-action-2',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toBe('link-action-2');
      expect(actionEventPublisher.getPublishedEvents()).toHaveLength(0);
    });

    it('logs error when executeLinkAction fails after approval', async () => {
      const linkAction: Action = {
        id: 'link-action-error',
        type: 'link',
        userId: 'user-1',
        title: 'Test link error',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(linkAction);

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');
      const mockExecuteLinkAction = async (
        _actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        return err({ name: 'NetworkError', code: 'NETWORK_ERROR', message: 'Link API failed' });
      };

      const useCaseWithError = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeLinkAction: mockExecuteLinkAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'link-action-error',
        buttonId: 'approve:link-action-error',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: 'link-action-error',
        }),
        'Failed to execute link action after approval'
      );
    });

    it('falls back to publishing event when executeLinkAction is not provided', async () => {
      const linkAction: Action = {
        id: 'link-action-3',
        type: 'link',
        userId: 'user-1',
        title: 'Test link',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(linkAction);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'link-action-3',
        buttonId: 'approve:link-action-3',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('link');
    });
  });

  describe('calendar action execution after approval', () => {
    it('calls executeCalendarAction directly when approving via button', async () => {
      const calendarAction: Action = {
        id: 'calendar-action-1',
        type: 'calendar',
        userId: 'user-1',
        title: 'Test calendar',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(calendarAction);

      const executeCalls: string[] = [];
      const mockExecuteCalendarAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeCalls.push(actionId);
        return ok({ status: 'completed' as const, message: 'Calendar event created!' });
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeCalendarAction: mockExecuteCalendarAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'calendar-action-1',
        buttonId: 'approve:calendar-action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toBe('calendar-action-1');
      expect(actionEventPublisher.getPublishedEvents()).toHaveLength(0);
    });

    it('falls back to publishing event when executeCalendarAction is not provided', async () => {
      const calendarAction: Action = {
        id: 'calendar-action-2',
        type: 'calendar',
        userId: 'user-1',
        title: 'Test calendar',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(calendarAction);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'calendar-action-2',
        buttonId: 'approve:calendar-action-2',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('calendar');
    });

    it('logs error when executeCalendarAction fails after approval', async () => {
      const calendarAction: Action = {
        id: 'calendar-action-error',
        type: 'calendar',
        userId: 'user-1',
        title: 'Test calendar error',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(calendarAction);

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');
      const mockExecuteCalendarAction = async (
        _actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        return err({ name: 'ApiError', code: 'API_ERROR', message: 'Calendar API failed' });
      };

      const useCaseWithError = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeCalendarAction: mockExecuteCalendarAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'calendar-action-error',
        buttonId: 'approve:calendar-action-error',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: 'calendar-action-error',
        }),
        'Failed to execute calendar action after approval'
      );
    });
  });

  describe('linear action execution after approval', () => {
    it('calls executeLinearAction directly when approving via button', async () => {
      const linearAction: Action = {
        id: 'linear-action-1',
        type: 'linear',
        userId: 'user-1',
        title: 'Test linear',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(linearAction);

      const executeCalls: string[] = [];
      const mockExecuteLinearAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeCalls.push(actionId);
        return ok({ status: 'completed' as const, message: 'Linear issue created!' });
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeLinearAction: mockExecuteLinearAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'linear-action-1',
        buttonId: 'approve:linear-action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toBe('linear-action-1');
      expect(actionEventPublisher.getPublishedEvents()).toHaveLength(0);
    });

    it('falls back to publishing event when executeLinearAction is not provided', async () => {
      const linearAction: Action = {
        id: 'linear-action-2',
        type: 'linear',
        userId: 'user-1',
        title: 'Test linear',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(linearAction);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'linear-action-2',
        buttonId: 'approve:linear-action-2',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('linear');
    });

    it('logs error when executeLinearAction fails after approval', async () => {
      const linearAction: Action = {
        id: 'linear-action-error',
        type: 'linear',
        userId: 'user-1',
        title: 'Test linear error',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(linearAction);

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');
      const mockExecuteLinearAction = async (
        _actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        return err({ name: 'NetworkError', code: 'NETWORK_ERROR', message: 'Linear API failed' });
      };

      const useCaseWithError = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeLinearAction: mockExecuteLinearAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'linear-action-error',
        buttonId: 'approve:linear-action-error',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: 'linear-action-error',
        }),
        'Failed to execute linear action after approval'
      );
    });
  });

  describe('code action execution after approval', () => {
    it('calls executeCodeAction directly when approving via button', async () => {
      const codeAction: Action = {
        id: 'code-action-1',
        type: 'code',
        userId: 'user-1',
        title: 'Test code',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(codeAction);

      const executeCalls: string[] = [];
      const mockExecuteCodeAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeCalls.push(actionId);
        return ok({ status: 'completed' as const, message: 'Code task created!' });
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeCodeAction: mockExecuteCodeAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'code-action-1',
        buttonId: 'approve:code-action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toBe('code-action-1');
      expect(actionEventPublisher.getPublishedEvents()).toHaveLength(0);
    });

    it('falls back to publishing event when executeCodeAction is not provided', async () => {
      const codeAction: Action = {
        id: 'code-action-2',
        type: 'code',
        userId: 'user-1',
        title: 'Test code',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(codeAction);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'code-action-2',
        buttonId: 'approve:code-action-2',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('code');
    });

    it('logs error when executeCodeAction returns error result', async () => {
      const codeAction: Action = {
        id: 'code-action-error',
        type: 'code',
        userId: 'user-1',
        title: 'Test code that will fail',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(codeAction);

      const executeCalls: string[] = [];
      const mockExecuteCodeAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeCalls.push(actionId);
        return err(new Error('Failed to create code task'));
      };

      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeCodeAction: mockExecuteCodeAction,
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'code-action-error',
        buttonId: 'approve:code-action-error',
      });

      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0]).toBe('code-action-error');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });
  });

  describe('reminder action (not implemented)', () => {
    it('logs warning for reminder actions and falls through to event publishing', async () => {
      const reminderAction: Action = {
        id: 'reminder-action-1',
        type: 'reminder',
        userId: 'user-1',
        title: 'Test reminder',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(reminderAction);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'reminder-action-1',
        buttonId: 'approve:reminder-action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
      expect(actionEventPublisher.getPublishedEvents()).toHaveLength(1);
      expect(actionEventPublisher.getPublishedEvents()[0]?.type).toBe('action.created');
    });
  });

  describe('event publish failure after approval', () => {
    it('logs error when action event publisher fails but continues execution', async () => {
      const linkAction: Action = {
        id: 'link-action-fallback',
        type: 'link',
        userId: 'user-1',
        title: 'Test link',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };
      await actionRepository.save(linkAction);

      actionEventPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'link-action-fallback',
        buttonId: 'approve:link-action-fallback',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      const action = await actionRepository.getById('link-action-fallback');
      expect(action?.status).toBe('pending');
    });
  });

  describe('executeActionByType error handling (via button approval)', () => {
    it('should log error when event publish fails for reminder action', async () => {
      const reminderAction: Action = {
        id: 'reminder-fallback-1',
        type: 'reminder',
        userId: 'user-1',
        title: 'Test reminder',
        status: 'awaiting_approval',
        confidence: 0.95,
        commandId: 'cmd-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        payload: {},
      };

      await actionRepository.save(reminderAction);
      actionEventPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'reminder-fallback-1',
        buttonId: 'approve:reminder-fallback-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      const action = await actionRepository.getById('reminder-fallback-1');
      expect(action?.status).toBe('pending');
    });
  });

  describe('executeRejection error handling (cancel/convert button)', () => {
    it('should handle WhatsApp publish failure on cancel confirmation', async () => {
      await actionRepository.save(testAction);
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'cancel:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }

      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('rejected');
    });

    it('should handle cleanup failure after cancel', async () => {
      await actionRepository.save(testAction);
      approvalMessageRepository.setMessage(testApprovalMessage);

      vi.spyOn(approvalMessageRepository, 'deleteByActionId').mockResolvedValueOnce(
        err({ code: 'PERSISTENCE_ERROR', message: 'Cleanup failed' })
      );

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'cancel:action-1',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('button response error handling (handleButtonResponse)', () => {
    it('should ack and notify when action null in button response', async () => {
      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'nonexistent-action',
        buttonId: 'approve:nonexistent-action',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }

      const sentMessages = whatsappPublisher.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.message).toContain('no longer available');
    });

    it('should handle WhatsApp publish failure after successful button approval', async () => {
      await actionRepository.save(testAction);
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('pending');
    });

    it('should handle cleanup failure after button approval', async () => {
      await actionRepository.save(testAction);
      approvalMessageRepository.setMessage(testApprovalMessage);

      vi.spyOn(approvalMessageRepository, 'deleteByActionId').mockResolvedValueOnce(
        err({ code: 'PERSISTENCE_ERROR', message: 'Cleanup failed' })
      );

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('handleButtonResponse - approve button race conditions', () => {
    it('should handle status_mismatch when approving via button', async () => {
      await actionRepository.save(testAction);

      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'status_mismatch',
        currentStatus: 'pending',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.actionId).toBe('action-1');
        expect(result.value.outcome).toBeUndefined();
      }
    });

    it('should handle not_found when updating status via button approval', async () => {
      await actionRepository.save(testAction);

      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'not_found',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }

      const sentMessages = whatsappPublisher.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.message).toContain('no longer available');
    });

    it('should handle error when updating status via button approval', async () => {
      await actionRepository.save(testAction);

      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'error',
        error: new Error('DB connection failed'),
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-1',
        buttonId: 'approve:action-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to update action status');
      }
    });
  });

  describe('rejection error handling (updateResult outcomes)', () => {
    it('handles status_mismatch when action already processed', async () => {
      await actionRepository.save({
        ...testAction,
        id: 'reject-status-mismatch-1',
      });

      actionRepository.setUpdateStatusIfResult('reject-status-mismatch-1', {
        outcome: 'status_mismatch',
        currentStatus: 'processed',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'reject-status-mismatch-1',
        buttonId: 'cancel:reject-status-mismatch-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
      }
    });

    it('handles not_found when action does not exist', async () => {
      await actionRepository.save({
        ...testAction,
        id: 'reject-not-found-1',
      });

      actionRepository.setUpdateStatusIfResult('reject-not-found-1', {
        outcome: 'not_found',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'reject-not-found-1',
        buttonId: 'cancel:reject-not-found-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }

      const sentMessages = whatsappPublisher.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.message).toContain('no longer available');
    });

    it('handles error when status update fails', async () => {
      await actionRepository.save({
        ...testAction,
        id: 'reject-error-1',
      });

      actionRepository.setUpdateStatusIfResult('reject-error-1', {
        outcome: 'error',
        error: new Error('Database connection failed'),
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'reject-error-1',
        buttonId: 'cancel:reject-error-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to update action status');
      }
    });
  });

  describe('cancel-task button (INT-379)', () => {
    it('returns error when codeAgentClient is not configured', async () => {
      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123:abcd',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Code agent client not configured');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('service temporarily unavailable');
    });

    it('returns error when nonce is missing from button ID', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Cancel-task button missing nonce');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('missing security code');
    });

    it('sends success message when task is cancelled', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123:validnonce',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('rejected');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('cancellation requested');

      const cancelled = codeAgentClient.getCancelledTasks();
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]).toMatchObject({
        taskId: 'task-123',
        nonce: 'validnonce',
        userId: 'user-1',
      });
    });

    it('sends error message when task not found', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();
      codeAgentClient.setNextCancelError({ code: 'TASK_NOT_FOUND', message: 'Not found' });

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123:abcd',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('rejected');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toBe('Task not found.');
    });

    it('sends error message when nonce is invalid', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();
      codeAgentClient.setNextCancelError({ code: 'INVALID_NONCE', message: 'Invalid' });

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123:wrongnonce',
      });

      expect(result.ok).toBe(true);

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('Invalid cancel code');
    });

    it('sends error message when nonce is expired', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();
      codeAgentClient.setNextCancelError({ code: 'NONCE_EXPIRED', message: 'Expired' });

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123:expirednonce',
      });

      expect(result.ok).toBe(true);

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toBe('Cancel link has expired.');
    });

    it('sends error message when user is not owner', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();
      codeAgentClient.setNextCancelError({ code: 'NOT_OWNER', message: 'Not owner' });

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123:abcd',
      });

      expect(result.ok).toBe(true);

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toBe('You are not the owner of this task.');
    });

    it('sends error message when task is not cancellable', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();
      codeAgentClient.setNextCancelError({ code: 'TASK_NOT_CANCELLABLE', message: 'Already done' });

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123:abcd',
      });

      expect(result.ok).toBe(true);

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('cannot be cancelled');
    });

    it('sends generic error message for unknown error codes', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();
      codeAgentClient.setNextCancelError({ code: 'UNKNOWN', message: 'Something went wrong' });

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123:abcd',
      });

      expect(result.ok).toBe(true);

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toBe('Unable to cancel task.');
    });
  });

  describe('cancel-task button edge cases', () => {
    it('should handle when nonce parsing results in undefined', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('missing nonce');
      }
    });

    it('should handle cancel-task when result.ok is false', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();
      codeAgentClient.setNextCancelError({ code: 'TASK_NOT_FOUND', message: 'Task not found' });
      whatsappPublisher.setFailNext(true);

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123:abcd',
      });

      expect(result.ok).toBe(true);
    });

    it('should handle when nonce parsing results in empty string taskId', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('missing nonce');
      }
    });

  });

  describe('handleButtonResponse - action null edge case', () => {
    it('should ack and notify when action lookup fails with buttonId', async () => {
      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'nonexistent-action',
        buttonId: 'approve:nonexistent-action',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(false);
      }

      const sentMessages = whatsappPublisher.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.message).toContain('no longer available');
    });
  });

  describe('proceed-implementation button (INT-628)', () => {
    it('returns error when codeAgentClient is not configured', async () => {
      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Code agent client not configured');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('service temporarily unavailable');
    });

    it('sends success message when phase 2 is submitted', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('approved');
      }

      const submitted = codeAgentClient.getSubmittedPhase2Tasks();
      expect(submitted).toHaveLength(1);
      expect(submitted[0]?.taskId).toBe('task-123');
      expect(submitted[0]?.userId).toBe('user-1');

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('Starting implementation');
    });

    it('sends error message when phase 2 submission fails with known error', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();
      codeAgentClient.setNextPhase2Error({
        code: 'INVALID_STATUS',
        message: 'Task is not in designed status',
      });

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('rejected');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('not in designed status');
    });

    it('sends generic error for unknown error codes', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();
      codeAgentClient.setNextPhase2Error({
        code: 'UNKNOWN',
        message: 'Unexpected error',
      });

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('Please try again later');
    });

    it('maps all known error codes to user-friendly messages', async () => {
      const errorCodes: { code: string; expected: string }[] = [
        { code: 'TASK_NOT_FOUND', expected: 'Task not found' },
        { code: 'NO_LINEAR_ISSUE', expected: 'no Linear issue' },
        { code: 'LABEL_NOT_READY', expected: 'not ready for implementation' },
        { code: 'ALREADY_IMPLEMENTED', expected: 'already started' },
        { code: 'ACTIVE_TASK_EXISTS', expected: 'active task already exists' },
        { code: 'WORKER_NOT_CONFIGURED', expected: 'no workers available' },
        { code: 'NETWORK_ERROR', expected: 'network error' },
      ];

      for (const { code, expected } of errorCodes) {
        whatsappPublisher.clearSentMessages();
        const { FakeCodeAgentClient } = await import('../fakes.js');
        const codeAgentClient = new FakeCodeAgentClient();
        codeAgentClient.setNextPhase2Error({
          code: code as 'TASK_NOT_FOUND',
          message: 'Test error',
        });

        const useCaseWithClient = createHandleApprovalReplyUseCase({
          actionRepository,
          approvalMessageRepository,
          whatsappPublisher,
          actionEventPublisher,
          codeAgentClient,
          logger: createMockLogger(),
          webAppUrl: 'https://test.intexuraos.cloud',
        });

        await useCaseWithClient({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          buttonId: 'proceed-implementation:task-123',
        });

        const messages = whatsappPublisher.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain(expected);
      }
    });

    it('logs warning when error notification fails for unconfigured client', async () => {
      whatsappPublisher.setFailNext(true, { code: 'PUBLISH_FAILED', message: 'Pub/Sub error' });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Code agent client not configured');
      }

      // Message was attempted but failed, so no sent messages
      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(0);
    });

    it('logs warning when error notification fails after phase2 submission error', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();
      codeAgentClient.setNextPhase2Error({
        code: 'INVALID_STATUS',
        message: 'Task is not in designed status',
      });

      // Make publisher fail when the error notification is sent
      whatsappPublisher.setFailNext(true, { code: 'PUBLISH_FAILED', message: 'Pub/Sub error' });

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }

      // Message was attempted but failed
      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(0);
    });

    it('logs warning when success notification fails after phase2 submission', async () => {
      const { FakeCodeAgentClient } = await import('../fakes.js');
      const codeAgentClient = new FakeCodeAgentClient();

      // Make publisher fail when the success notification is sent
      whatsappPublisher.setFailNext(true, { code: 'PUBLISH_FAILED', message: 'Pub/Sub error' });

      const useCaseWithClient = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
        webAppUrl: 'https://test.intexuraos.cloud',
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'proceed-implementation:task-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.outcome).toBe('approved');
      }

      // Message was attempted but failed
      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(0);
    });
  });
});
