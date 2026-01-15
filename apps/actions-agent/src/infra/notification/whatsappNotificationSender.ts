/**
 * WhatsApp notification sender using Pub/Sub for message delivery.
 * Messages are published to the whatsapp-send topic which whatsapp-service processes.
 * Phone number lookup is handled internally by whatsapp-service.
 */

import type { Logger } from 'pino';
import {
  createWhatsAppSendPublisher,
  type WhatsAppSendPublisher,
} from '@intexuraos/infra-pubsub';
import { ok, type Result } from '@intexuraos/common-core';
import type { NotificationSender } from '../../domain/ports/notificationSender.js';

export interface WhatsAppNotificationSenderConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}

export class WhatsAppNotificationSender implements NotificationSender {
  private readonly publisher: WhatsAppSendPublisher;

  constructor(config: WhatsAppNotificationSenderConfig) {
    this.publisher = createWhatsAppSendPublisher({
      projectId: config.projectId,
      topicName: config.topicName,
      logger: config.logger,
    });
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
  config: WhatsAppNotificationSenderConfig
): NotificationSender {
  return new WhatsAppNotificationSender(config);
}
