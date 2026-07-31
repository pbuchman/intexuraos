import type {
  WhatsAppDigestClientFailureCode,
  WhatsAppServiceClient,
} from '@intexuraos/internal-clients';
import type {
  MessageDigestClientResult,
  MessageDigestDeliveryReadiness,
  MessageDigestOutboundDeliveryState,
  MessageDigestSourcePage,
  MessageDigestWhatsAppClient,
  QueryMessageDigestSourceInput,
  ValidatedMessageDigestSource,
} from '../../domain/ports/messageDigestClients.js';

export function createWhatsAppDigestClient(
  client: Pick<
    WhatsAppServiceClient,
    | 'validatePrivateDigestSource'
    | 'queryPrivateDigestMessages'
    | 'getWhatsAppDeliveryReadiness'
    | 'getOutboundDeliveryState'
    | 'authorizeOutboundDeliveryRetry'
  >
): MessageDigestWhatsAppClient {
  return {
    async validateSource(input): Promise<MessageDigestClientResult<ValidatedMessageDigestSource>> {
      const result = await client.validatePrivateDigestSource({
        userId: input.userId,
        chatId: input.chatId,
        ...(input.expectedGenerationId === undefined
          ? {}
          : { expectedGenerationId: input.expectedGenerationId }),
      });
      if (!result.ok) return { ok: false, code: mapFailure(result.error.code) };
      return {
        ok: true,
        value: {
          sourceAccountId: result.value.sourceAccountId,
          generationId: result.value.generationId,
          chatId: result.value.chatId,
          chatType: result.value.chatType,
          displayName: result.value.displayName,
          messageCount: result.value.messageCount,
          ...(result.value.participantCount === undefined
            ? {}
            : { participantCount: result.value.participantCount }),
          ...(result.value.lastActivityAt === undefined
            ? {}
            : { lastActivityAt: result.value.lastActivityAt }),
          sourceRevision: result.value.sourceRevision,
        },
      };
    },

    async getDeliveryReadiness(
      userId
    ): Promise<MessageDigestClientResult<MessageDigestDeliveryReadiness>> {
      const result = await client.getWhatsAppDeliveryReadiness(userId);
      if (!result.ok) return { ok: false, code: mapFailure(result.error.code) };
      return {
        ok: true,
        value: {
          status: result.value.status,
          ...(result.value.maskedPrimaryNumber === undefined
            ? {}
            : { maskedPrimaryNumber: result.value.maskedPrimaryNumber }),
          observationVersion: result.value.observationVersion,
          observedAt: result.value.observedAt,
        },
      };
    },

    async getOutboundDeliveryState(
      input
    ): Promise<MessageDigestClientResult<MessageDigestOutboundDeliveryState>> {
      const result = await client.getOutboundDeliveryState(input);
      if (!result.ok) return { ok: false, code: mapFailure(result.error.code) };
      if (result.value.status === 'sent') {
        if (result.value.acceptedAt === undefined) {
          return { ok: false, code: 'invalid_response' };
        }
        return {
          ok: true,
          value: { status: 'sent', acceptedAt: result.value.acceptedAt },
        };
      }
      if (result.value.status === 'ambiguous') {
        return {
          ok: true,
          value: {
            status: 'ambiguous',
            ...(result.value.acceptedAt === undefined
              ? {}
              : { acceptedAt: result.value.acceptedAt }),
          },
        };
      }
      if (result.value.status === 'failed') {
        if (result.value.failedAt === undefined || result.value.failureCode === undefined) {
          return { ok: false, code: 'invalid_response' };
        }
        return {
          ok: true,
          value: {
            status: 'failed',
            failedAt: result.value.failedAt,
            failureCode: result.value.failureCode,
          },
        };
      }
      return { ok: true, value: { status: result.value.status } };
    },

    async authorizeOutboundDeliveryRetry(
      input
    ): ReturnType<MessageDigestWhatsAppClient['authorizeOutboundDeliveryRetry']> {
      const result = await client.authorizeOutboundDeliveryRetry(input);
      if (!result.ok) return { ok: false, code: mapRetryFailure(result.error.code) };
      return { ok: true };
    },

    async queryMessages(
      input: QueryMessageDigestSourceInput
    ): Promise<MessageDigestClientResult<MessageDigestSourcePage>> {
      const result = await client.queryPrivateDigestMessages({
        userId: input.userId,
        sourceAccountId: input.sourceAccountId,
        generationId: input.generationId,
        chatId: input.chatId,
        chatType: input.chatType,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
      if (!result.ok) return { ok: false, code: mapFailure(result.error.code) };
      return {
        ok: true,
        value: {
          messages: result.value.messages.map((message) => ({
            messageRef: message.messageRef,
            eventTimestamp: message.eventTimestamp,
            direction: message.direction,
            authorLabel: message.authorLabel,
            text: message.text,
            contentKind: message.contentKind,
          })),
          sourceRevision: result.value.sourceRevision,
          highWatermark: result.value.highWatermark,
          nextCursor: result.value.nextCursor,
        },
      };
    },
  };
}

function mapFailure(
  code: WhatsAppDigestClientFailureCode
): 'invalid_request' | 'unavailable' | 'source_changed' | 'not_found' | 'invalid_response' {
  if (
    code === 'invalid_request' ||
    code === 'source_changed' ||
    code === 'not_found' ||
    code === 'invalid_response'
  ) {
    return code;
  }
  return 'unavailable';
}

function mapRetryFailure(
  code: WhatsAppDigestClientFailureCode
): 'invalid_request' | 'unavailable' | 'not_found' | 'invalid_response' {
  if (code === 'invalid_request' || code === 'not_found' || code === 'invalid_response') {
    return code;
  }
  return 'unavailable';
}
