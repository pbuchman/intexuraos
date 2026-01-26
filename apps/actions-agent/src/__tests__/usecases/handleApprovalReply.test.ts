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
});
