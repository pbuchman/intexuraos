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

export interface WhatsAppNotificationSenderConfig extends WhatsAppSendPublisherConfig {
  webAppUrl: string;
}

export class WhatsAppNotificationSender implements NotificationSender {
  private readonly publisher: WhatsAppSendPublisher;
  private readonly webAppUrl: string;

  constructor(config: WhatsAppNotificationSenderConfig) {
    this.publisher = createWhatsAppSendPublisher(config);
    this.webAppUrl = config.webAppUrl;
  }

  async sendResearchComplete(
    userId: string,
    researchId: string,
    title: string
  ): Promise<Result<void, NotificationError>> {
    const message = this.formatResearchCompleteMessage(title, researchId);
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

  private formatResearchCompleteMessage(title: string, researchId: string): string {
    const displayTitle = title !== '' ? title : 'Untitled Research';
    const researchUrl = `${this.webAppUrl}/#/research/${researchId}`;
    return `Research Complete!\n\n"${displayTitle}"\n${researchUrl}`;
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
