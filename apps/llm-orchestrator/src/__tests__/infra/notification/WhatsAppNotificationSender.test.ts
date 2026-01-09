/**
 * Tests for WhatsAppNotificationSender.
 */

import { LlmModels } from '@intexuraos/llm-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@intexuraos/common-core';

const mockPublishSendMessage = vi.fn();

vi.mock('@intexuraos/infra-pubsub', () => ({
  createWhatsAppSendPublisher: vi.fn().mockReturnValue({
    publishSendMessage: mockPublishSendMessage,
  }),
}));

const { WhatsAppNotificationSender } =
  await import('../../../infra/notification/WhatsAppNotificationSender.js');

describe('WhatsAppNotificationSender', () => {
  const mockConfig = {
    projectId: 'test-project',
    topicName: 'test-topic',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendResearchComplete', () => {
    it('publishes message with userId', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig);
      const result = await sender.sendResearchComplete(
        'user-123',
        'research-456',
        'AI Research',
        'https://share.example.com/research.html'
      );

      expect(result.ok).toBe(true);
      expect(mockPublishSendMessage).toHaveBeenCalledWith({
        userId: 'user-123',
        message: expect.stringContaining('AI Research'),
        correlationId: 'research-research-456',
      });
    });

    it('formats message with title', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig);
      await sender.sendResearchComplete(
        'user-123',
        'research-456',
        'My Research Title',
        'https://share.example.com/research.html'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('"My Research Title"'),
        })
      );
    });

    it('uses default title when empty', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig);
      await sender.sendResearchComplete(
        'user-123',
        'research-456',
        '',
        'https://share.example.com/research.html'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Untitled Research'),
        })
      );
    });

    it('includes Research Complete header in message', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig);
      await sender.sendResearchComplete(
        'user-123',
        'research-456',
        'Test',
        'https://share.example.com/research.html'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Research Complete!'),
        })
      );
    });

    it('includes share URL in message', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig);
      await sender.sendResearchComplete(
        'user-123',
        'research-456',
        'Test',
        'https://intexuraos.cloud/share/research/abc123-token-test.html'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(
            'https://intexuraos.cloud/share/research/abc123-token-test.html'
          ),
        })
      );
    });
  });

  describe('sendLlmFailure', () => {
    it('publishes message with userId and model name', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig);
      const result = await sender.sendLlmFailure(
        'user-123',
        'research-456',
        LlmModels.Gemini25Pro,
        'API Error'
      );

      expect(result.ok).toBe(true);
      expect(mockPublishSendMessage).toHaveBeenCalledWith({
        userId: 'user-123',
        message: expect.stringContaining(LlmModels.Gemini25Pro),
        correlationId: 'research-failure-research-456',
      });
    });

    it('includes model name in message for openai models', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig);
      await sender.sendLlmFailure(
        'user-123',
        'research-456',
        LlmModels.O4MiniDeepResearch,
        'Timeout'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(LlmModels.O4MiniDeepResearch),
        })
      );
    });

    it('includes model name in message for anthropic models', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig);
      await sender.sendLlmFailure(
        'user-123',
        'research-456',
        LlmModels.ClaudeOpus45,
        'Key invalid'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(LlmModels.ClaudeOpus45),
        })
      );
    });

    it('includes error message in notification', async () => {
      mockPublishSendMessage.mockResolvedValue(ok(undefined));

      const sender = new WhatsAppNotificationSender(mockConfig);
      await sender.sendLlmFailure(
        'user-123',
        'research-456',
        LlmModels.Gemini25Flash,
        'Rate limit exceeded'
      );

      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Rate limit exceeded'),
        })
      );
    });
  });
});
