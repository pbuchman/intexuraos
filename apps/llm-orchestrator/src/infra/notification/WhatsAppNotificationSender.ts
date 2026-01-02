/**
 * WhatsApp notification sender implementing NotificationSender port.
 * Uses Pub/Sub to request message sending via whatsapp-service.
 * Phone number lookup is handled internally by whatsapp-service.
 */

import {
  createWhatsAppSendPublisher,
  type WhatsAppSendPublisher,
  type WhatsAppSendPublisherConfig,
} from '@intexuraos/infra-pubsub';
import { ok, type Result } from '@intexuraos/common-core';
import type {
  LlmProvider,
  NotificationError,
  NotificationSender,
} from '../../domain/research/index.js';

export class WhatsAppNotificationSender implements NotificationSender {
  private readonly publisher: WhatsAppSendPublisher;

  constructor(config: WhatsAppSendPublisherConfig) {
    this.publisher = createWhatsAppSendPublisher(config);
  }

  async sendResearchComplete(
    userId: string,
    researchId: string,
    title: string,
    shareUrl: string
  ): Promise<Result<void, NotificationError>> {
    const message = this.formatResearchCompleteMessage(title, shareUrl);
    await this.publisher.publishSendMessage({
      userId,
      message,
      correlationId: `research-${researchId}`,
    });

    return ok(undefined);
  }

  async sendLlmFailure(
    userId: string,
    researchId: string,
    provider: LlmProvider,
    error: string
  ): Promise<Result<void, NotificationError>> {
    const message = this.formatFailureMessage(provider, error);
    await this.publisher.publishSendMessage({
      userId,
      message,
      correlationId: `research-failure-${researchId}`,
    });

    return ok(undefined);
  }

  private formatResearchCompleteMessage(title: string, shareUrl: string): string {
    const displayTitle = title !== '' ? title : 'Untitled Research';
    return `Research Complete!\n\n"${displayTitle}"\n${shareUrl}`;
  }

  private formatFailureMessage(provider: LlmProvider, error: string): string {
    const providerName = this.getProviderDisplayName(provider);
    return `Research Alert: ${providerName} failed.\n\nError: ${error}\n\nCheck your dashboard for options.`;
  }

  private getProviderDisplayName(provider: LlmProvider): string {
    switch (provider) {
      case 'google':
        return 'Google Gemini';
      case 'openai':
        return 'OpenAI GPT';
      case 'anthropic':
        return 'Anthropic Claude';
    }
  }
}
