import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';

export class FakeWhatsAppSendPublisher implements WhatsAppSendPublisher {
  public publishedMessages: {
    userId: string;
    message: string;
    replyToMessageId?: string;
    correlationId: string;
  }[] = [];
  private nextError: PublishError | null = null;

  setNextError(error: PublishError): void {
    this.nextError = error;
  }

  async publishSendMessage(params: {
    userId: string;
    message: string;
    replyToMessageId?: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>> {
    if (this.nextError !== null) {
      const error = this.nextError;
      this.nextError = null;
      return { ok: false, error };
    }

    this.publishedMessages.push({
      userId: params.userId,
      message: params.message,
      ...(params.replyToMessageId !== undefined && { replyToMessageId: params.replyToMessageId }),
      correlationId: params.correlationId ?? crypto.randomUUID(),
    });
    return ok(undefined);
  }

  clear(): void {
    this.publishedMessages = [];
    this.nextError = null;
  }
}
