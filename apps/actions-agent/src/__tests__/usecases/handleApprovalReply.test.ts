import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHandleApprovalReplyUseCase } from '../../domain/usecases/handleApprovalReply.js';
import type { HandleApprovalReplyUseCase } from '../../domain/usecases/handleApprovalReply.js';
import {
  FakeActionRepository,
  FakeApprovalMessageRepository,
  FakeWhatsAppSendPublisher,
} from '../fakes.js';
import type {
  ApprovalIntentClassifier,
  ApprovalIntentResult,
} from '../../domain/ports/approvalIntentClassifier.js';
import type {
  ApprovalIntentClassifierFactory,
  ApprovalIntentClassifierFactoryError,
} from '../../domain/ports/approvalIntentClassifierFactory.js';
import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Action } from '../../domain/models/action.js';
import type { ApprovalMessage } from '../../domain/models/approvalMessage.js';
import pino from 'pino';

// Fake ApprovalIntentClassifier
class FakeApprovalIntentClassifier implements ApprovalIntentClassifier {
  private nextResult: ApprovalIntentResult = {
    intent: 'approve',
    confidence: 0.95,
    reasoning: 'User expressed approval',
  };

  setResult(result: ApprovalIntentResult): void {
    this.nextResult = result;
  }

  async classify(_text: string): Promise<ApprovalIntentResult> {
    return this.nextResult;
  }
}

// Fake ApprovalIntentClassifierFactory
class FakeApprovalIntentClassifierFactory implements ApprovalIntentClassifierFactory {
  private classifier: FakeApprovalIntentClassifier = new FakeApprovalIntentClassifier();
  private error: ApprovalIntentClassifierFactoryError | null = null;

  setClassifier(classifier: FakeApprovalIntentClassifier): void {
    this.classifier = classifier;
    this.error = null;
  }

  setError(error: ApprovalIntentClassifierFactoryError): void {
    this.error = error;
  }

  getClassifier(): FakeApprovalIntentClassifier {
    return this.classifier;
  }

  async createForUser(
    _userId: string,
    _logger: Logger
  ): Promise<Result<ApprovalIntentClassifier, ApprovalIntentClassifierFactoryError>> {
    if (this.error !== null) {
      return err(this.error);
    }
    return ok(this.classifier);
  }
}

describe('HandleApprovalReplyUseCase', () => {
  let actionRepository: FakeActionRepository;
  let approvalMessageRepository: FakeApprovalMessageRepository;
  let classifierFactory: FakeApprovalIntentClassifierFactory;
  let whatsappPublisher: FakeWhatsAppSendPublisher;
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
    classifierFactory = new FakeApprovalIntentClassifierFactory();
    whatsappPublisher = new FakeWhatsAppSendPublisher();

    useCase = createHandleApprovalReplyUseCase({
      actionRepository,
      approvalMessageRepository,
      approvalIntentClassifierFactory: classifierFactory,
      whatsappPublisher,
      logger: pino({ level: 'silent' }),
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
      // No approval message set

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
    it('returns error when action not found', async () => {
      approvalMessageRepository.setMessage(testApprovalMessage);
      // No action in repository

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Action not found');
      }
    });

    it('cleans up orphaned approval message when action not found via wamid lookup', async () => {
      approvalMessageRepository.setMessage(testApprovalMessage);
      // No action in repository

      await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
      });

      // Should have cleaned up the orphaned approval message
      const messages = approvalMessageRepository.getMessages();
      expect(messages).toHaveLength(0);
    });

    it('does not clean up approval message when action ID was provided directly', async () => {
      approvalMessageRepository.setMessage(testApprovalMessage);
      // No action in repository

      await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1', // Provided directly
      });

      // Should NOT have cleaned up the approval message since actionId was provided
      const messages = approvalMessageRepository.getMessages();
      expect(messages).toHaveLength(1);
    });

    it('logs warning when cleanup of orphaned approval message fails', async () => {
      approvalMessageRepository.setMessage(testApprovalMessage);
      // No action in repository

      // First call succeeds (findByWamid), second call fails (deleteByActionId)
      const originalDeleteByActionId = approvalMessageRepository.deleteByActionId.bind(
        approvalMessageRepository
      );
      vi.spyOn(approvalMessageRepository, 'deleteByActionId').mockImplementationOnce(
        async () => err({ code: 'PERSISTENCE_ERROR', message: 'Failed to delete' })
      );

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
      });

      // Should still return error about action not found
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Action not found');
      }

      // Restore original implementation
      vi.mocked(approvalMessageRepository.deleteByActionId).mockImplementation(
        originalDeleteByActionId
      );
    });

    it('returns error when user ID mismatch on action', async () => {
      await actionRepository.save({
        ...testAction,
        userId: 'different-user',
      });
      approvalMessageRepository.setMessage({
        ...testApprovalMessage,
        userId: 'user-1', // Approval message matches requesting user
      });

      // Use actionId directly to bypass approval message userId check
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
    it('returns early when action is no longer awaiting_approval', async () => {
      await actionRepository.save({
        ...testAction,
        status: 'pending', // Already moved past awaiting_approval
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

  describe('classifier creation errors', () => {
    it('sends error message when LLM classifier creation fails with NO_API_KEY', async () => {
      await actionRepository.save(testAction);
      classifierFactory.setError({
        code: 'NO_API_KEY',
        message: 'User has no API key configured',
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

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('LLM API key is not configured');
    });

    it('sends error message when LLM classifier creation fails with INVALID_MODEL', async () => {
      await actionRepository.save(testAction);
      classifierFactory.setError({
        code: 'INVALID_MODEL',
        message: 'Invalid model configured',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('unclear_requested_clarification');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('LLM model preference is invalid');
    });

    it('sends generic error message for other classifier creation failures', async () => {
      await actionRepository.save(testAction);
      classifierFactory.setError({
        code: 'UNKNOWN_ERROR',
        message: 'Something went wrong',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('unclear_requested_clarification');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('temporary issue');
      expect(messages[0]?.message).toContain('todo');
      expect(messages[0]?.message).toContain('Test todo action');
    });

    it('handles WhatsApp publish failure on error notification silently', async () => {
      await actionRepository.save(testAction);
      classifierFactory.setError({
        code: 'NO_API_KEY',
        message: 'User has no API key',
      });
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      // Should still succeed despite WhatsApp failure
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('unclear_requested_clarification');
      }
    });
  });

  describe('approval intent handling', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
    });

    it('approves action when intent is approve', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User said yes',
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
        expect(result.value.intent).toBe('approve');
        expect(result.value.outcome).toBe('approved');
      }

      // Action should be updated to pending
      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('pending');

      // Confirmation message should be sent
      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('Approved!');
      expect(messages[0]?.message).toContain('todo');
    });

    it('rejects action when intent is reject', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'reject',
        confidence: 0.9,
        reasoning: 'User said no',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'no thanks',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.intent).toBe('reject');
        expect(result.value.outcome).toBe('rejected');
      }

      // Action should be updated to rejected with reason in payload
      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('rejected');
      expect(action?.payload['rejection_reason']).toBe('no thanks');
      expect(action?.payload['rejected_at']).toBeDefined();

      // Confirmation message should be sent
      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('Rejected');
      expect(messages[0]?.message).toContain('todo');
    });

    it('requests clarification when intent is unclear', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'unclear',
        confidence: 0.4,
        reasoning: 'Cannot determine intent',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'maybe later',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.intent).toBe('unclear');
        expect(result.value.outcome).toBe('unclear_requested_clarification');
      }

      // Action should remain unchanged
      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('awaiting_approval');

      // Clarification request should be sent
      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain("didn't understand");
      expect(messages[0]?.message).toContain('"yes"');
      expect(messages[0]?.message).toContain('"no"');
    });
  });

  describe('approval message cleanup', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
      approvalMessageRepository.setMessage(testApprovalMessage);
    });

    it('cleans up approval message after approval', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      const messages = approvalMessageRepository.getMessages();
      expect(messages).toHaveLength(0);
    });

    it('cleans up approval message after rejection', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'reject',
        confidence: 0.9,
        reasoning: 'User rejected',
      });

      await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'no',
        userId: 'user-1',
        actionId: 'action-1',
      });

      const messages = approvalMessageRepository.getMessages();
      expect(messages).toHaveLength(0);
    });

    it('does not clean up approval message for unclear intent', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'unclear',
        confidence: 0.4,
        reasoning: 'Cannot determine',
      });

      await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'maybe',
        userId: 'user-1',
        actionId: 'action-1',
      });

      const messages = approvalMessageRepository.getMessages();
      expect(messages).toHaveLength(1);
    });
  });

  describe('WhatsApp publish failures', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
    });

    it('handles publish failure for approval confirmation silently', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      // Should still succeed - action is updated
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('pending');
    });

    it('handles publish failure for rejection confirmation silently', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'reject',
        confidence: 0.9,
        reasoning: 'User rejected',
      });
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'no',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }

      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('rejected');
    });

    it('handles publish failure for clarification request silently', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'unclear',
        confidence: 0.4,
        reasoning: 'Cannot determine',
      });
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'hmm',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('unclear_requested_clarification');
      }
    });
  });

  describe('approval message cleanup failures', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
      approvalMessageRepository.setMessage(testApprovalMessage);
    });

    it('logs warning when cleanup fails after approval but still succeeds', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      // Mock deleteByActionId to fail
      vi.spyOn(approvalMessageRepository, 'deleteByActionId').mockResolvedValueOnce(
        err({ code: 'PERSISTENCE_ERROR', message: 'Cleanup failed' })
      );

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      // Should still succeed
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });

    it('logs warning when cleanup fails after rejection but still succeeds', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'reject',
        confidence: 0.9,
        reasoning: 'User rejected',
      });

      vi.spyOn(approvalMessageRepository, 'deleteByActionId').mockResolvedValueOnce(
        err({ code: 'PERSISTENCE_ERROR', message: 'Cleanup failed' })
      );

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'no',
        userId: 'user-1',
        actionId: 'action-1',
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
      // Don't set approval message - should still work with actionId

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCase({
        replyToWamid: 'wamid-unused',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.actionId).toBe('action-1');
        expect(result.value.outcome).toBe('approved');
      }
    });
  });
});
