/**
 * WhatsApp notification sender implementing NotificationSender port.
 * Uses Pub/Sub to request message sending via whatsapp-service.
 */

import {
  createWhatsAppSendPublisher,
  type WhatsAppSendPublisher,
  type WhatsAppSendPublisherConfig,
} from '@intexuraos/infra-pubsub';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { NotificationError, NotificationSender } from '../../domain/research/index.js';

export interface UserPhoneLookup {
  getPhoneNumber(userId: string): Promise<string | null>;
}

export class WhatsAppNotificationSender implements NotificationSender {
  private readonly publisher: WhatsAppSendPublisher;
  private readonly userPhoneLookup: UserPhoneLookup;

  constructor(config: WhatsAppSendPublisherConfig, userPhoneLookup: UserPhoneLookup) {
    this.publisher = createWhatsAppSendPublisher(config);
    this.userPhoneLookup = userPhoneLookup;
  }

  async sendResearchComplete(
    userId: string,
    researchId: string,
    title: string
  ): Promise<Result<void, NotificationError>> {
    const phone = await this.userPhoneLookup.getPhoneNumber(userId);

    if (phone === null) {
      return err({
        code: 'USER_NOT_CONNECTED',
        message: 'User has no WhatsApp phone number configured',
      });
    }

    const message = this.formatMessage(title, researchId);
    const result = await this.publisher.publishSendMessage({
      userId,
      phoneNumber: phone,
      message,
      correlationId: `research-${researchId}`,
    });

    if (!result.ok) {
      return err({
        code: 'SEND_FAILED',
        message: result.error.message,
      });
    }

    return ok(undefined);
  }

  private formatMessage(title: string, _researchId: string): string {
    const displayTitle = title !== '' ? title : 'Untitled Research';
    return `Research Complete!\n\n"${displayTitle}"\n\nView results in your dashboard.`;
  }
}
