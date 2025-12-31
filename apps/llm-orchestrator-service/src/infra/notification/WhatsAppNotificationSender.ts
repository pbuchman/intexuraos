/**
 * WhatsApp notification sender implementing NotificationSender port.
 */

import {
  createWhatsAppClient,
  type WhatsAppClient,
  type WhatsAppConfig,
} from '@intexuraos/infra-whatsapp';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { NotificationError, NotificationSender } from '../../domain/research/index.js';

export interface UserPhoneLookup {
  getPhoneNumber(userId: string): Promise<string | null>;
}

export class WhatsAppNotificationSender implements NotificationSender {
  private readonly client: WhatsAppClient;
  private readonly userPhoneLookup: UserPhoneLookup;

  constructor(config: WhatsAppConfig, userPhoneLookup: UserPhoneLookup) {
    this.client = createWhatsAppClient(config);
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
    const result = await this.client.sendTextMessage({
      to: phone,
      message,
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
