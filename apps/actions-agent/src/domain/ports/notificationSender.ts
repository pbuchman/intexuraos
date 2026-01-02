import type { Result } from '@intexuraos/common-core';

export interface NotificationSender {
  sendDraftReady(
    userId: string,
    researchId: string,
    title: string,
    draftUrl: string
  ): Promise<Result<void>>;
}
