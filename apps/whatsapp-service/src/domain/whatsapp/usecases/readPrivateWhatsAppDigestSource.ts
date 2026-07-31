import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  PrivateDigestSourceError,
  QueryPrivateDigestMessagesInput,
  QueryPrivateDigestMessagesResult,
} from '../models/PrivateWhatsAppDigestSource.js';
import type {
  PrivateDigestSourceTokenCodec,
  PrivateWhatsAppDigestSourceRepository,
} from '../ports/privateWhatsAppDigestSourceRepository.js';
import { projectPrivateDigestMessages } from './privateWhatsAppDigestSource.js';

export interface ReadPrivateWhatsAppDigestSourceDeps {
  repository: PrivateWhatsAppDigestSourceRepository;
  tokens: Pick<PrivateDigestSourceTokenCodec, 'createMessageRef'>;
}

export async function readPrivateWhatsAppDigestSource(
  input: QueryPrivateDigestMessagesInput,
  deps: ReadPrivateWhatsAppDigestSourceDeps
): Promise<Result<QueryPrivateDigestMessagesResult, PrivateDigestSourceError>> {
  const rawPage = await deps.repository.queryMessages(input);
  if (!rawPage.ok) return err(rawPage.error);
  const windowStart = normalizeIsoTimestamp(input.windowStart);
  const windowEnd = normalizeIsoTimestamp(input.windowEnd);
  if (windowStart === undefined || windowEnd === undefined) {
    return err({ code: 'VALIDATION_ERROR', message: 'Invalid private digest source query' });
  }
  const windowStartTime = Date.parse(windowStart);
  const windowEndTime = Date.parse(windowEnd);
  const projectedMessages = projectPrivateDigestMessages(
    rawPage.value.messages,
    ({ messageId, projectionKey }) =>
      deps.tokens.createMessageRef({
        userId: input.userId,
        sourceAccountId: input.sourceAccountId,
        generationId: input.generationId,
        chatId: input.chatId,
        chatType: input.chatType,
        windowStart,
        windowEnd,
        messageId,
        projectionKey,
      })
  );

  return ok({
    messages: projectedMessages.filter((message) => {
      const eventTime = Date.parse(message.eventTimestamp);
      return Number.isFinite(eventTime) && eventTime >= windowStartTime && eventTime < windowEndTime;
    }),
    sourceRevision: rawPage.value.sourceRevision,
    highWatermark: rawPage.value.highWatermark,
    nextCursor: rawPage.value.nextCursor,
  });
}

function normalizeIsoTimestamp(value: string): string | undefined {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}
