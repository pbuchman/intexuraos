/**
 * WhatsApp notification sender using Pub/Sub for message delivery.
 * Messages are published to the whatsapp-send topic which whatsapp-service processes.
 * Phone number lookup is handled internally by whatsapp-service.
 */

import {
  createWhatsAppSendPublisher,
  type WhatsAppSendPublisher,
  type WhatsAppSendPublisherConfig,
} from '@intexuraos/infra-pubsub';
import { ok, type Result } from '@intexuraos/common-core';
import type { NotificationSender } from '../../domain/ports/notificationSender.js';

export class WhatsAppNotificationSender implements NotificationSender {
  private readonly publisher: WhatsAppSendPublisher;

  constructor(config: WhatsAppSendPublisherConfig) {
    this.publisher = createWhatsAppSendPublisher(config);
  }

  async sendDraftReady(
    userId: string,
    researchId: string,
    title: string,
    draftUrl: string
  ): Promise<Result<void>> {
    const displayTitle = title !== '' ? title : 'Untitled Research';
    const message = `Research Complete!\n\n"${displayTitle}"\n${draftUrl}`;

    await this.publisher.publishSendMessage({
      userId,
      message,
      correlationId: `research-draft-ready-${researchId}`,
    });

    return ok(undefined);
  }
}

export function createWhatsappNotificationSender(
  config: WhatsAppSendPublisherConfig
): NotificationSender {
  return new WhatsAppNotificationSender(config);
}
