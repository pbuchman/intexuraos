import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHandleApprovalReplyUseCase } from '../../domain/usecases/handleApprovalReply.js';
import type { HandleApprovalReplyUseCase } from '../../domain/usecases/handleApprovalReply.js';
import {
  FakeActionRepository,
  FakeApprovalMessageRepository,
  FakeWhatsAppSendPublisher,
  FakeActionEventPublisher,
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

// Create a proper logger mock that actually logs (for coverage)
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
    classifierFactory = new FakeApprovalIntentClassifierFactory();
    whatsappPublisher = new FakeWhatsAppSendPublisher();
    actionEventPublisher = new FakeActionEventPublisher();

    useCase = createHandleApprovalReplyUseCase({
      actionRepository,
      approvalMessageRepository,
      approvalIntentClassifierFactory: classifierFactory,
      whatsappPublisher,
      actionEventPublisher,
      logger: createMockLogger(),
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

    it('proceeds with classification when action is pending (not terminal)', async () => {
      await actionRepository.save({
        ...testAction,
        status: 'pending',
      });
      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      // Should proceed to classification but status_mismatch on update
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.actionId).toBe('action-1');
        // No intent/outcome because updateStatusIf returns status_mismatch
        expect(result.value.intent).toBeUndefined();
      }
    });
  });

  describe('race condition prevention (atomic status updates)', () => {
    beforeEach(async () => {
      await actionRepository.save(testAction);
    });

    it('prevents duplicate approval when status already changed (race condition)', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      // Simulate race condition: status changed between read and update
      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'status_mismatch',
        currentStatus: 'pending',
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
        // No intent/outcome because race condition was detected
        expect(result.value.intent).toBeUndefined();
        expect(result.value.outcome).toBeUndefined();
      }

      // No WhatsApp messages sent (we bailed early)
      expect(whatsappPublisher.getSentMessages()).toHaveLength(0);
    });

    it('prevents duplicate rejection when status already changed (race condition)', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'reject',
        confidence: 0.9,
        reasoning: 'User rejected',
      });

      // Simulate race condition: status changed between read and update
      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'status_mismatch',
        currentStatus: 'pending',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'no',
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

      // No WhatsApp messages sent
      expect(whatsappPublisher.getSentMessages()).toHaveLength(0);
    });

    it('returns error when action not found during approval update', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'not_found',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Action not found');
      }
    });

    it('returns error when action not found during rejection update', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'reject',
        confidence: 0.9,
        reasoning: 'User rejected',
      });

      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'not_found',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'no',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Action not found');
      }
    });

    it('returns error when update fails during approval', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'error',
        error: new Error('Firestore transaction failed'),
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to update action status');
      }
    });

    it('returns error when update fails during rejection', async () => {
      classifierFactory.getClassifier().setResult({
        intent: 'reject',
        confidence: 0.9,
        reasoning: 'User rejected',
      });

      actionRepository.setUpdateStatusIfResult('action-1', {
        outcome: 'error',
        error: new Error('Firestore transaction failed'),
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'no',
        userId: 'user-1',
        actionId: 'action-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to update action status');
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

  describe('note action execution after approval (no duplicate notification)', () => {
    it('calls executeNoteAction directly when approving a note action (does not publish event)', async () => {
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

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      // Create a mock executeNoteAction function
      const executeNoteActionCalls: string[] = [];
      const mockExecuteNoteAction = async (
        actionId: string
      ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
        executeNoteActionCalls.push(actionId);
        return ok({ status: 'completed' as const, message: 'Note created!' });
      };

      // Create usecase with executeNoteAction
      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeNoteAction: mockExecuteNoteAction,
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'note-action-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      // executeNoteAction should have been called directly
      expect(executeNoteActionCalls).toHaveLength(1);
      expect(executeNoteActionCalls[0]).toBe('note-action-1');

      // action.created event should NOT have been published (prevents duplicate notification)
      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(0);
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

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      // useCase does not have executeNoteAction (the default in beforeEach)
      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'note-action-2',
      });

      expect(result.ok).toBe(true);

      // action.created event should be published when executeNoteAction not available
      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
    });

    it('publishes event for non-note actions even when executeNoteAction is provided', async () => {
      const linkAction: Action = {
        id: 'link-action-1',
        userId: 'user-1',
        commandId: 'cmd-1',
        type: 'link',
        confidence: 0.95,
        title: 'Save this link',
        status: 'awaiting_approval',
        payload: { url: 'https://example.com' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      await actionRepository.save(linkAction);

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeNoteAction: mockExecuteNoteAction,
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'link-action-1',
      });

      expect(result.ok).toBe(true);

      // executeNoteAction should NOT be called for non-note actions
      expect(executeNoteActionCalls).toHaveLength(0);

      // action.created event should be published for link actions (fallback)
      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('link');
    });
  });

  describe('todo action execution after approval', () => {
    it('calls executeTodoAction directly when approving (does not publish event)', async () => {
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeTodoAction: mockExecuteTodoAction,
      });

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'todo-action-1',
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

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'todo-action-2',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('todo');
    });
  });

  describe('research action execution after approval', () => {
    it('calls executeResearchAction directly when approving (does not publish event)', async () => {
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeResearchAction: mockExecuteResearchAction,
      });

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'research-action-1',
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

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'research-action-2',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('research');
    });
  });

  describe('link action execution after approval', () => {
    it('calls executeLinkAction directly when approving (does not publish event)', async () => {
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeLinkAction: mockExecuteLinkAction,
      });

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'link-action-2',
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeLinkAction: mockExecuteLinkAction,
      });

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'link-action-error',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      // Verify error was logged
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

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'link-action-3',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('link');
    });
  });

  describe('calendar action execution after approval', () => {
    it('calls executeCalendarAction directly when approving (does not publish event)', async () => {
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeCalendarAction: mockExecuteCalendarAction,
      });

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'calendar-action-1',
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

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'calendar-action-2',
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeCalendarAction: mockExecuteCalendarAction,
      });

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'calendar-action-error',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      // Verify error was logged
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: 'calendar-action-error',
        }),
        'Failed to execute calendar action after approval'
      );
    });
  });

  describe('linear action execution after approval', () => {
    it('calls executeLinearAction directly when approving (does not publish event)', async () => {
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeLinearAction: mockExecuteLinearAction,
      });

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'linear-action-1',
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

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'linear-action-2',
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeLinearAction: mockExecuteLinearAction,
      });

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'linear-action-error',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      // Verify error was logged
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: 'linear-action-error',
        }),
        'Failed to execute linear action after approval'
      );
    });
  });

  describe('execute function failure handling', () => {
    it('logs error but returns success when execute function fails', async () => {
      const calendarAction: Action = {
        id: 'calendar-action-fail',
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

      const failingExecute = async (): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> =>
        err(new Error('Execution failed'));

      const useCaseWithFailingExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeCalendarAction: failingExecute,
      });

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCaseWithFailingExecute({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'calendar-action-fail',
      });

      // Should still return approved (execution is best-effort)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });
  });

  describe('reminder action (not implemented)', () => {
    it('logs warning for reminder actions (no execute function exists)', async () => {
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

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'reminder-action-1',
      });

      // Should succeed and publish event (reminder falls through to event publishing)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
      expect(actionEventPublisher.getPublishedEvents()).toHaveLength(1);
      expect(actionEventPublisher.getPublishedEvents()[0]?.type).toBe('action.created');
    });
  });

  describe('code action execution after approval', () => {
    it('calls executeCodeAction directly when approving (does not publish event)', async () => {
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeCodeAction: mockExecuteCodeAction,
      });

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'code-action-1',
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

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'code-action-2',
      });

      expect(result.ok).toBe(true);

      const publishedEvents = actionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.actionType).toBe('code');
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

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      // Make event publisher fail (no execute function provided, so falls back to event publishing)
      actionEventPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'yes',
        userId: 'user-1',
        actionId: 'link-action-fallback',
      });

      // Should still succeed despite event publish failure
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      // Action should still be updated to pending
      const action = await actionRepository.getById('link-action-fallback');
      expect(action?.status).toBe('pending');
    });
  });

  describe('rejection metadata update failure', () => {
    it('logs warning but continues when adding rejection metadata throws error', async () => {
      await actionRepository.save(testAction);

      classifierFactory.getClassifier().setResult({
        intent: 'reject',
        confidence: 0.9,
        reasoning: 'User rejected',
      });

      // Mock actionRepository.update to throw error
      const originalUpdate = actionRepository.update.bind(actionRepository);
      let callCount = 0;
      vi.spyOn(actionRepository, 'update').mockImplementation(async (action: Action) => {
        callCount++;
        if (callCount === 1) {
          // First call is the status update via updateStatusIf - let it succeed
          return originalUpdate(action);
        }
        // Second call is the metadata update - throw error
        throw new Error('Database connection lost');
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'no thanks',
        userId: 'user-1',
        actionId: 'action-1',
      });

      // Should still succeed despite metadata update failure
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }

      // Action should still be rejected (status updated via updateStatusIf)
      const action = await actionRepository.getById('action-1');
      expect(action?.status).toBe('rejected');
    });
  });

  describe('button response handling', () => {
    const actionWithNonce: Action = {
      id: 'action-nonce-1',
      userId: 'user-1',
      commandId: 'cmd-1',
      type: 'todo',
      confidence: 0.85,
      title: 'Test todo with nonce',
      status: 'awaiting_approval',
      payload: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      approvalNonce: 'abcd',
      approvalNonceExpiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    };

    describe('approve button with valid nonce', () => {
      it('approves action when button has valid nonce', async () => {
        await actionRepository.save(actionWithNonce);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-nonce-1',
          buttonId: 'approve:action-nonce-1:abcd',
          buttonTitle: 'Approve',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.matched).toBe(true);
          expect(result.value.actionId).toBe('action-nonce-1');
          expect(result.value.intent).toBe('approve');
          expect(result.value.outcome).toBe('approved');
        }

        // Action should be updated to pending
        const action = await actionRepository.getById('action-nonce-1');
        expect(action?.status).toBe('pending');
        // Nonce should be cleared after approval
        expect(action?.approvalNonce).toBeUndefined();
      });

      it('sends approval confirmation message', async () => {
        await actionRepository.save(actionWithNonce);

        await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-nonce-1',
          buttonId: 'approve:action-nonce-1:abcd',
          buttonTitle: 'Approve',
        });

        const messages = whatsappPublisher.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Approved!');
        expect(messages[0]?.message).toContain('todo');
      });
    });

    describe('approve button with invalid nonce', () => {
      it('returns error when nonce is missing from button', async () => {
        await actionRepository.save(actionWithNonce);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-nonce-1',
          buttonId: 'approve:action-nonce-1', // Missing nonce
          buttonTitle: 'Approve',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Approve button missing nonce');
        }

        // Should send error message
        const messages = whatsappPublisher.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('missing security code');
      });

      it('returns error when action has no nonce configured', async () => {
        const { approvalNonce: _n, approvalNonceExpiresAt: _e, ...baseAction } = actionWithNonce;
        const actionWithoutNonce: Action = {
          ...baseAction,
          id: 'action-no-nonce',
        };
        await actionRepository.save(actionWithoutNonce);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-no-nonce',
          buttonId: 'approve:action-no-nonce:abcd',
          buttonTitle: 'Approve',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Action has no nonce configured');
        }

        const messages = whatsappPublisher.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('expired');
      });

      it('returns error when nonce is expired', async () => {
        const expiredAction: Action = {
          ...actionWithNonce,
          id: 'action-expired-nonce',
          approvalNonceExpiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        };
        await actionRepository.save(expiredAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-expired-nonce',
          buttonId: 'approve:action-expired-nonce:abcd',
          buttonTitle: 'Approve',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Approval nonce expired');
        }
      });

      it('returns error when nonce does not match', async () => {
        await actionRepository.save(actionWithNonce);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-nonce-1',
          buttonId: 'approve:action-nonce-1:wxyz', // Wrong nonce
          buttonTitle: 'Approve',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Nonce mismatch');
        }

        const messages = whatsappPublisher.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Invalid approval code');
      });
    });

    describe('cancel button', () => {
      it('rejects action when cancel button clicked', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'cancel:action-1',
          buttonTitle: 'Cancel',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.matched).toBe(true);
          expect(result.value.intent).toBe('reject');
          expect(result.value.outcome).toBe('rejected');
        }

        // Action should be rejected
        const action = await actionRepository.getById('action-1');
        expect(action?.status).toBe('rejected');

        // Should send cancellation message
        const messages = whatsappPublisher.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Cancelled');
      });
    });

    describe('convert button', () => {
      it('rejects action with convert message when convert button clicked', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'convert:action-1',
          buttonTitle: 'Convert to Linear',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.matched).toBe(true);
          expect(result.value.intent).toBe('reject');
          expect(result.value.outcome).toBe('rejected');
        }

        // Should send convert message
        const messages = whatsappPublisher.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Converting');
        expect(messages[0]?.message).toContain('Linear');
      });
    });

    describe('invalid button ID', () => {
      it('returns error for invalid button ID format', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'invalid', // No colon separator
          buttonTitle: 'Invalid',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Invalid button ID format');
        }
      });

      it('returns error for unknown button intent', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'unknown:action-1',
          buttonTitle: 'Unknown',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Unknown button intent');
        }
      });

      it('returns error when button action ID does not match', async () => {
        await actionRepository.save(testAction);

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'cancel:different-action-id',
          buttonTitle: 'Cancel',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Button action ID mismatch');
        }
      });
    });

    describe('race condition prevention for button responses', () => {
      it('handles race condition when action already processed during approval', async () => {
        await actionRepository.save(actionWithNonce);
        actionRepository.setUpdateStatusIfResult('action-nonce-1', {
          outcome: 'status_mismatch',
          currentStatus: 'pending',
        });

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-nonce-1',
          buttonId: 'approve:action-nonce-1:abcd',
          buttonTitle: 'Approve',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.matched).toBe(true);
          expect(result.value.intent).toBeUndefined();
        }
      });

      it('handles race condition when action already processed during cancellation', async () => {
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
          buttonId: 'cancel:action-1',
          buttonTitle: 'Cancel',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.matched).toBe(true);
        }
      });

      it('returns error when action not found during button approval', async () => {
        await actionRepository.save(actionWithNonce);
        actionRepository.setUpdateStatusIfResult('action-nonce-1', {
          outcome: 'not_found',
        });

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-nonce-1',
          buttonId: 'approve:action-nonce-1:abcd',
          buttonTitle: 'Approve',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Action not found');
        }
      });

      it('returns error when update fails during button approval', async () => {
        await actionRepository.save(actionWithNonce);
        actionRepository.setUpdateStatusIfResult('action-nonce-1', {
          outcome: 'error',
          error: new Error('Database error'),
        });

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-nonce-1',
          buttonId: 'approve:action-nonce-1:abcd',
          buttonTitle: 'Approve',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Failed to update action status');
        }
      });

      it('returns error when action not found during button cancel', async () => {
        await actionRepository.save(testAction);
        actionRepository.setUpdateStatusIfResult('action-1', {
          outcome: 'not_found',
        });

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'cancel:action-1',
          buttonTitle: 'Cancel',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Action not found');
        }
      });

      it('returns error when update fails during button cancel', async () => {
        await actionRepository.save(testAction);
        actionRepository.setUpdateStatusIfResult('action-1', {
          outcome: 'error',
          error: new Error('Database error'),
        });

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-1',
          buttonId: 'cancel:action-1',
          buttonTitle: 'Cancel',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('Failed to update action status');
        }
      });
    });

    describe('nonce clearing failure', () => {
      it('logs warning but continues when clearing nonce fails', async () => {
        await actionRepository.save(actionWithNonce);

        // Make update fail after first successful updateStatusIf
        const originalUpdate = actionRepository.update.bind(actionRepository);
        vi.spyOn(actionRepository, 'update').mockImplementationOnce(async () => {
          throw new Error('Failed to clear nonce');
        });

        const result = await useCase({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'action-nonce-1',
          buttonId: 'approve:action-nonce-1:abcd',
          buttonTitle: 'Approve',
        });

        // Should still succeed
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.outcome).toBe('approved');
        }

        // Restore original
        vi.mocked(actionRepository.update).mockImplementation(originalUpdate);
      });
    });

    describe('button approval with execute functions', () => {
      it('executes action directly via button approval', async () => {
        const noteActionWithNonce: Action = {
          ...actionWithNonce,
          id: 'note-btn-1',
          type: 'note',
        };
        await actionRepository.save(noteActionWithNonce);

        const executeCalls: string[] = [];
        const mockExecuteNoteAction = async (
          actionId: string
        ): Promise<Result<{ status: 'completed' | 'failed'; message?: string }>> => {
          executeCalls.push(actionId);
          return ok({ status: 'completed' as const });
        };

        const useCaseWithExecute = createHandleApprovalReplyUseCase({
          actionRepository,
          approvalMessageRepository,
          approvalIntentClassifierFactory: classifierFactory,
          whatsappPublisher,
          actionEventPublisher,
          logger: createMockLogger(),
          executeNoteAction: mockExecuteNoteAction,
        });

        const result = await useCaseWithExecute({
          replyToWamid: 'wamid-123',
          replyText: '',
          userId: 'user-1',
          actionId: 'note-btn-1',
          buttonId: 'approve:note-btn-1:abcd',
          buttonTitle: 'Approve',
        });

        expect(result.ok).toBe(true);
        expect(executeCalls).toHaveLength(1);
        expect(executeCalls[0]).toBe('note-btn-1');
      });
    });
  });

  describe('text-based nonce fallback', () => {
    const actionWithNonce: Action = {
      id: 'action-text-nonce',
      userId: 'user-1',
      commandId: 'cmd-1',
      type: 'todo',
      confidence: 0.85,
      title: 'Test todo with nonce',
      status: 'awaiting_approval',
      payload: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      approvalNonce: 'abcd',
      approvalNonceExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    it('approves action when user types "approve XXXX" with valid nonce', async () => {
      await actionRepository.save(actionWithNonce);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve abcd',
        userId: 'user-1',
        actionId: 'action-text-nonce',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
        expect(result.value.intent).toBe('approve');
        expect(result.value.outcome).toBe('approved');
      }

      const action = await actionRepository.getById('action-text-nonce');
      expect(action?.status).toBe('pending');
    });

    it('handles case-insensitive nonce', async () => {
      await actionRepository.save(actionWithNonce);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve ABCD',
        userId: 'user-1',
        actionId: 'action-text-nonce',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });

    it('falls through to LLM when action has no nonce', async () => {
      const { approvalNonce: _n, approvalNonceExpiresAt: _e, ...baseAction } = actionWithNonce;
      const actionNoNonce: Action = {
        ...baseAction,
        id: 'action-no-nonce-text',
      };
      await actionRepository.save(actionNoNonce);

      classifierFactory.getClassifier().setResult({
        intent: 'approve',
        confidence: 0.95,
        reasoning: 'User approved',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve 1234',
        userId: 'user-1',
        actionId: 'action-no-nonce-text',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });

    it('returns rejected when nonce is expired via text', async () => {
      const expiredAction: Action = {
        ...actionWithNonce,
        id: 'action-expired-text',
        approvalNonceExpiresAt: new Date(Date.now() - 3600000).toISOString(),
      };
      await actionRepository.save(expiredAction);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve abcd',
        userId: 'user-1',
        actionId: 'action-expired-text',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('expired');
    });

    it('returns rejected when nonce does not match via text', async () => {
      await actionRepository.save(actionWithNonce);

      // Use a valid 4-hex-digit nonce (1234) that doesn't match stored 'abcd'
      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve 1234',
        userId: 'user-1',
        actionId: 'action-text-nonce',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('Invalid approval code');
    });

    it('handles race condition in text nonce approval', async () => {
      await actionRepository.save(actionWithNonce);
      actionRepository.setUpdateStatusIfResult('action-text-nonce', {
        outcome: 'status_mismatch',
        currentStatus: 'pending',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve abcd',
        userId: 'user-1',
        actionId: 'action-text-nonce',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
      }
    });

    it('returns error when action not found during text nonce approval', async () => {
      await actionRepository.save(actionWithNonce);
      actionRepository.setUpdateStatusIfResult('action-text-nonce', {
        outcome: 'not_found',
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve abcd',
        userId: 'user-1',
        actionId: 'action-text-nonce',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Action not found');
      }
    });

    it('returns error when update fails during text nonce approval', async () => {
      await actionRepository.save(actionWithNonce);
      actionRepository.setUpdateStatusIfResult('action-text-nonce', {
        outcome: 'error',
        error: new Error('Database error'),
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve abcd',
        userId: 'user-1',
        actionId: 'action-text-nonce',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Failed to update action status');
      }
    });

    it('logs warning but continues when clearing nonce fails in text approval', async () => {
      await actionRepository.save(actionWithNonce);

      const originalUpdate = actionRepository.update.bind(actionRepository);
      vi.spyOn(actionRepository, 'update').mockImplementationOnce(async () => {
        throw new Error('Failed to clear nonce');
      });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve abcd',
        userId: 'user-1',
        actionId: 'action-text-nonce',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }

      vi.mocked(actionRepository.update).mockImplementation(originalUpdate);
    });

    it('logs warning when nonce mismatch error notification fails', async () => {
      await actionRepository.save(actionWithNonce);

      // Make the whatsapp publish fail for nonce mismatch notification
      whatsappPublisher.setFailNext(true, { code: 'PUBLISH_FAILED', message: 'Network error' });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve 1234', // Wrong nonce (should be abcd)
        userId: 'user-1',
        actionId: 'action-text-nonce',
      });

      // Should still return rejected even if notification fails
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }
    });

    it('logs warning when approval confirmation fails via text', async () => {
      await actionRepository.save(actionWithNonce);

      // Use a fresh use case with a failing publisher just for the confirmation
      let callCount = 0;
      const failingPublisher = {
        async publishSendMessage(): Promise<{ ok: false; error: { code: string; message: string } }> {
          callCount++;
          return { ok: false, error: { code: 'PUBLISH_FAILED', message: 'Failed to send' } };
        },
        getSentMessages: (): never[] => [],
        setFailNext: (): void => { /* no-op */ },
      };

      const useCaseWithFailingPublisher = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher: failingPublisher as unknown as typeof whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
      });

      const result = await useCaseWithFailingPublisher({
        replyToWamid: 'wamid-123',
        replyText: 'approve abcd',
        userId: 'user-1',
        actionId: 'action-text-nonce',
      });

      // Should still succeed even if confirmation notification fails
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
      expect(callCount).toBeGreaterThan(0);
    });

    it('logs warning when approval message cleanup fails via text', async () => {
      await actionRepository.save(actionWithNonce);

      // Make approval message cleanup fail
      approvalMessageRepository.setFailNext(true, { code: 'PERSISTENCE_ERROR', message: 'DB error' });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve abcd',
        userId: 'user-1',
        actionId: 'action-text-nonce',
      });

      // Should still succeed even if cleanup fails
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });
  });

  describe('execute action by type (button path)', () => {
    const createActionWithNonce = (type: Action['type'], id: string): Action => ({
      id,
      userId: 'user-1',
      commandId: 'cmd-1',
      type,
      confidence: 0.85,
      title: `Test ${type}`,
      status: 'awaiting_approval',
      payload: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      approvalNonce: 'abcd',
      approvalNonceExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    });

    it('executes todo action via button', async () => {
      await actionRepository.save(createActionWithNonce('todo', 'todo-btn-1'));

      const executeCalls: string[] = [];
      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeTodoAction: async (id: string) => {
          executeCalls.push(id);
          return ok({ status: 'completed' as const });
        },
      });

      await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'todo-btn-1',
        buttonId: 'approve:todo-btn-1:abcd',
      });

      expect(executeCalls).toContain('todo-btn-1');
    });

    it('executes research action via button', async () => {
      await actionRepository.save(createActionWithNonce('research', 'research-btn-1'));

      const executeCalls: string[] = [];
      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeResearchAction: async (id: string) => {
          executeCalls.push(id);
          return ok({ status: 'completed' as const });
        },
      });

      await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'research-btn-1',
        buttonId: 'approve:research-btn-1:abcd',
      });

      expect(executeCalls).toContain('research-btn-1');
    });

    it('executes link action via button', async () => {
      await actionRepository.save(createActionWithNonce('link', 'link-btn-1'));

      const executeCalls: string[] = [];
      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeLinkAction: async (id: string) => {
          executeCalls.push(id);
          return ok({ status: 'completed' as const });
        },
      });

      await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'link-btn-1',
        buttonId: 'approve:link-btn-1:abcd',
      });

      expect(executeCalls).toContain('link-btn-1');
    });

    it('executes calendar action via button', async () => {
      await actionRepository.save(createActionWithNonce('calendar', 'calendar-btn-1'));

      const executeCalls: string[] = [];
      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeCalendarAction: async (id: string) => {
          executeCalls.push(id);
          return ok({ status: 'completed' as const });
        },
      });

      await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'calendar-btn-1',
        buttonId: 'approve:calendar-btn-1:abcd',
      });

      expect(executeCalls).toContain('calendar-btn-1');
    });

    it('executes linear action via button', async () => {
      await actionRepository.save(createActionWithNonce('linear', 'linear-btn-1'));

      const executeCalls: string[] = [];
      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeLinearAction: async (id: string) => {
          executeCalls.push(id);
          return ok({ status: 'completed' as const });
        },
      });

      await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'linear-btn-1',
        buttonId: 'approve:linear-btn-1:abcd',
      });

      expect(executeCalls).toContain('linear-btn-1');
    });

    it('executes code action via button', async () => {
      await actionRepository.save(createActionWithNonce('code', 'code-btn-1'));

      const executeCalls: string[] = [];
      const useCaseWithExecute = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: createMockLogger(),
        executeCodeAction: async (id: string) => {
          executeCalls.push(id);
          return ok({ status: 'completed' as const });
        },
      });

      await useCaseWithExecute({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'code-btn-1',
        buttonId: 'approve:code-btn-1:abcd',
      });

      expect(executeCalls).toContain('code-btn-1');
    });

    it('falls back to event for reminder action via button', async () => {
      await actionRepository.save(createActionWithNonce('reminder', 'reminder-btn-1'));

      await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'reminder-btn-1',
        buttonId: 'approve:reminder-btn-1:abcd',
      });

      const events = actionEventPublisher.getPublishedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.actionType).toBe('reminder');
    });

    it('logs error when execute function fails via button', async () => {
      await actionRepository.save(createActionWithNonce('note', 'note-fail-btn'));

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');

      const useCaseWithError = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeNoteAction: async () => err(new Error('Execute failed')),
      });

      const result = await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'note-fail-btn',
        buttonId: 'approve:note-fail-btn:abcd',
      });

      expect(result.ok).toBe(true);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('logs error when todo execute fails via button', async () => {
      await actionRepository.save(createActionWithNonce('todo', 'todo-fail-btn'));

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');

      const useCaseWithError = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeTodoAction: async () => err(new Error('Todo failed')),
      });

      await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'todo-fail-btn',
        buttonId: 'approve:todo-fail-btn:abcd',
      });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'todo-fail-btn' }),
        'Failed to execute todo action after approval'
      );
    });

    it('logs error when research execute fails via button', async () => {
      await actionRepository.save(createActionWithNonce('research', 'research-fail-btn'));

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');

      const useCaseWithError = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeResearchAction: async () => err(new Error('Research failed')),
      });

      await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'research-fail-btn',
        buttonId: 'approve:research-fail-btn:abcd',
      });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'research-fail-btn' }),
        'Failed to execute research action after approval'
      );
    });

    it('logs error when calendar execute fails via button', async () => {
      await actionRepository.save(createActionWithNonce('calendar', 'cal-fail-btn'));

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');

      const useCaseWithError = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeCalendarAction: async () => err(new Error('Calendar failed')),
      });

      await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'cal-fail-btn',
        buttonId: 'approve:cal-fail-btn:abcd',
      });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'cal-fail-btn' }),
        'Failed to execute calendar action after approval'
      );
    });

    it('logs error when linear execute fails via button', async () => {
      await actionRepository.save(createActionWithNonce('linear', 'lin-fail-btn'));

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');

      const useCaseWithError = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeLinearAction: async () => err(new Error('Linear failed')),
      });

      await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'lin-fail-btn',
        buttonId: 'approve:lin-fail-btn:abcd',
      });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'lin-fail-btn' }),
        'Failed to execute linear action after approval'
      );
    });

    it('logs error when code execute fails via button', async () => {
      await actionRepository.save(createActionWithNonce('code', 'code-fail-btn'));

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');

      const useCaseWithError = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeCodeAction: async () => err(new Error('Code failed')),
      });

      await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'code-fail-btn',
        buttonId: 'approve:code-fail-btn:abcd',
      });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'code-fail-btn' }),
        'Failed to execute code action after approval'
      );
    });

    it('logs error when link execute fails via button', async () => {
      await actionRepository.save(createActionWithNonce('link', 'link-fail-btn'));

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');

      const useCaseWithError = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
        executeLinkAction: async () => err(new Error('Link failed')),
      });

      await useCaseWithError({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'link-fail-btn',
        buttonId: 'approve:link-fail-btn:abcd',
      });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'link-fail-btn' }),
        'Failed to execute link action after approval'
      );
    });

    it('falls back to event when no execute function for action type via button', async () => {
      await actionRepository.save(createActionWithNonce('link', 'link-no-exec'));

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'link-no-exec',
        buttonId: 'approve:link-no-exec:abcd',
      });

      expect(result.ok).toBe(true);
      const events = actionEventPublisher.getPublishedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.actionType).toBe('link');
    });

    it('logs error when event publish fails via button', async () => {
      await actionRepository.save(createActionWithNonce('link', 'link-event-fail'));
      actionEventPublisher.setFailNext(true);

      const errorLogger = createMockLogger();
      const errorSpy = vi.spyOn(errorLogger, 'error');

      const useCaseWithLogger = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: errorLogger,
      });

      const result = await useCaseWithLogger({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'link-event-fail',
        buttonId: 'approve:link-event-fail:abcd',
      });

      expect(result.ok).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'link-event-fail' }),
        'Failed to publish action.created event after approval'
      );
    });
  });

  describe('WhatsApp publish failures in button handling', () => {
    const actionWithNonce: Action = {
      id: 'action-wa-fail',
      userId: 'user-1',
      commandId: 'cmd-1',
      type: 'todo',
      confidence: 0.85,
      title: 'Test',
      status: 'awaiting_approval',
      payload: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      approvalNonce: 'abcd',
      approvalNonceExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    it('continues when nonce error notification fails', async () => {
      await actionRepository.save(actionWithNonce);
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-wa-fail',
        buttonId: 'approve:action-wa-fail', // Missing nonce
      });

      expect(result.ok).toBe(false);
    });

    it('continues when approval confirmation fails', async () => {
      await actionRepository.save(actionWithNonce);
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-wa-fail',
        buttonId: 'approve:action-wa-fail:abcd',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });

    it('continues when cancellation confirmation fails', async () => {
      const { approvalNonce: _n, approvalNonceExpiresAt: _e, ...baseAction } = actionWithNonce;
      await actionRepository.save(baseAction);
      whatsappPublisher.setFailNext(true);

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-wa-fail',
        buttonId: 'cancel:action-wa-fail',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }
    });
  });

  describe('approval message cleanup failures in button handling', () => {
    const actionWithNonce: Action = {
      id: 'action-cleanup-fail',
      userId: 'user-1',
      commandId: 'cmd-1',
      type: 'todo',
      confidence: 0.85,
      title: 'Test',
      status: 'awaiting_approval',
      payload: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      approvalNonce: 'abcd',
      approvalNonceExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    it('continues when cleanup fails after button approval', async () => {
      await actionRepository.save(actionWithNonce);
      approvalMessageRepository.setMessage({
        id: 'approval-1',
        wamid: 'wamid-123',
        actionId: 'action-cleanup-fail',
        actionType: 'todo',
        actionTitle: 'Test',
        userId: 'user-1',
        sentAt: '2026-01-01T00:00:00.000Z',
      });

      vi.spyOn(approvalMessageRepository, 'deleteByActionId').mockResolvedValueOnce(
        err({ code: 'PERSISTENCE_ERROR', message: 'Cleanup failed' })
      );

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-cleanup-fail',
        buttonId: 'approve:action-cleanup-fail:abcd',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('approved');
      }
    });

    it('continues when cleanup fails after button cancel', async () => {
      const { approvalNonce: _n, approvalNonceExpiresAt: _e, ...baseAction } = actionWithNonce;
      await actionRepository.save({
        ...baseAction,
        id: 'action-cancel-cleanup-fail',
      });

      vi.spyOn(approvalMessageRepository, 'deleteByActionId').mockResolvedValueOnce(
        err({ code: 'PERSISTENCE_ERROR', message: 'Cleanup failed' })
      );

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'action-cancel-cleanup-fail',
        buttonId: 'cancel:action-cancel-cleanup-fail',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
      }
    });
  });

  describe('execute action success logging via button', () => {
    const createActionWithNonce = (type: Action['type'], id: string): Action => ({
      id,
      userId: 'user-1',
      commandId: 'cmd-1',
      type,
      confidence: 0.85,
      title: `Test ${type}`,
      status: 'awaiting_approval',
      payload: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      approvalNonce: 'abcd',
      approvalNonceExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    });

    it('logs success when linear action executes successfully via button', async () => {
      await actionRepository.save(createActionWithNonce('linear', 'linear-success-btn'));

      const successLogger = createMockLogger();
      const infoSpy = vi.spyOn(successLogger, 'info');

      const useCaseWithLogger = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: successLogger,
        executeLinearAction: async () => ok({ status: 'completed' as const }),
      });

      await useCaseWithLogger({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'linear-success-btn',
        buttonId: 'approve:linear-success-btn:abcd',
      });

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'linear-success-btn' }),
        'Linear action executed successfully after approval'
      );
    });

    it('logs success when code action executes successfully via button', async () => {
      await actionRepository.save(createActionWithNonce('code', 'code-success-btn'));

      const successLogger = createMockLogger();
      const infoSpy = vi.spyOn(successLogger, 'info');

      const useCaseWithLogger = createHandleApprovalReplyUseCase({
        actionRepository,
        approvalMessageRepository,
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        logger: successLogger,
        executeCodeAction: async () => ok({ status: 'completed' as const }),
      });

      await useCaseWithLogger({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'code-success-btn',
        buttonId: 'approve:code-success-btn:abcd',
      });

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'code-success-btn' }),
        'Code action executed successfully after approval'
      );
    });

    it('falls back to event when no executeLinearAction provided via button', async () => {
      await actionRepository.save(createActionWithNonce('linear', 'linear-no-exec'));

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'linear-no-exec',
        buttonId: 'approve:linear-no-exec:abcd',
      });

      expect(result.ok).toBe(true);
      const events = actionEventPublisher.getPublishedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.actionType).toBe('linear');
    });

    it('falls back to event when no executeCodeAction provided via button', async () => {
      await actionRepository.save(createActionWithNonce('code', 'code-no-exec'));

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        actionId: 'code-no-exec',
        buttonId: 'approve:code-no-exec:abcd',
      });

      expect(result.ok).toBe(true);
      const events = actionEventPublisher.getPublishedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.actionType).toBe('code');
    });
  });

  describe('text-based nonce expired notification failures', () => {
    const expiredAction: Action = {
      id: 'action-text-expired',
      userId: 'user-1',
      commandId: 'cmd-1',
      type: 'todo',
      confidence: 0.85,
      title: 'Test todo with expired nonce',
      status: 'awaiting_approval',
      payload: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      approvalNonce: 'abcd',
      approvalNonceExpiresAt: new Date(Date.now() - 3600000).toISOString(), // Expired
    };

    it('logs warning when expired nonce notification fails via text', async () => {
      await actionRepository.save(expiredAction);

      // Make the whatsapp publish fail for expired notification
      whatsappPublisher.setFailNext(true, { code: 'PUBLISH_FAILED', message: 'Network error' });

      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: 'approve abcd',
        userId: 'user-1',
        actionId: 'action-text-expired',
      });

      // Should still return rejected even if notification fails
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.outcome).toBe('rejected');
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
      });

      const result = await useCaseWithClient({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'cancel-task:task-123', // Missing nonce
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
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
        approvalIntentClassifierFactory: classifierFactory,
        whatsappPublisher,
        actionEventPublisher,
        codeAgentClient,
        logger: createMockLogger(),
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

  describe('view-task button (INT-379)', () => {
    it('sends task URL message on view-task button', async () => {
      const result = await useCase({
        replyToWamid: 'wamid-123',
        replyText: '',
        userId: 'user-1',
        buttonId: 'view-task:task-abc',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.matched).toBe(true);
      }

      const messages = whatsappPublisher.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain('https://app.intexuraos.cloud/#/tasks/task-abc');
    });
  });
});
