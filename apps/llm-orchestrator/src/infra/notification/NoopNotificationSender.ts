/**
 * No-op notification sender for testing and when WhatsApp is not configured.
 */

import { ok, type Result } from '@intexuraos/common-core';
import type { NotificationError, NotificationSender } from '../../domain/research/index.js';

export class NoopNotificationSender implements NotificationSender {
  sendResearchComplete(
    _userId: string,
    _researchId: string,
    _title: string
  ): Promise<Result<void, NotificationError>> {
    /* Silently succeed - notifications are optional */
    return Promise.resolve(ok(undefined));
  }
}
