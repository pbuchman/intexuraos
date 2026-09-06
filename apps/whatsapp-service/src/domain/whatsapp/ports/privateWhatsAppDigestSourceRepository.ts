import type { Result } from '@intexuraos/common-core';
import type {
  PrivateDigestChatType,
  PrivateDigestSourceError,
  PrivateDigestSourcePosition,
  PrivateDigestSourceRevisionClaims,
  QueryPrivateDigestMessagesInput,
} from '../models/PrivateWhatsAppDigestSource.js';
import type { PrivateWhatsAppMessage } from '../models/PrivateWhatsApp.js';

export interface PrivateDigestSourceRouteBinding {
  userId: string;
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: PrivateDigestChatType;
  windowStart: string;
  windowEnd: string;
}

export interface PrivateDigestSourceHighWatermarkClaims
  extends PrivateDigestSourceRouteBinding {
  watermark: PrivateDigestSourcePosition;
}

export interface PrivateDigestSourceCursorClaims extends PrivateDigestSourceRouteBinding {
  watermark: PrivateDigestSourcePosition;
  position: PrivateDigestSourcePosition;
  validatedContextSequence: number;
  sourceRevision: string;
  highWatermark: string;
}

export interface PrivateDigestSourceMessageReferenceClaims
  extends PrivateDigestSourceRouteBinding {
  messageId: string;
  projectionKey: string;
}

export interface PrivateDigestSourceTokenCodec {
  issueSourceRevision(
    claims: PrivateDigestSourceRevisionClaims
  ): Result<string, PrivateDigestSourceError>;
  issueHighWatermark(
    claims: PrivateDigestSourceHighWatermarkClaims
  ): Result<string, PrivateDigestSourceError>;
  issueCursor(claims: PrivateDigestSourceCursorClaims): Result<string, PrivateDigestSourceError>;
  readCursor(input: {
    token: string;
    binding: PrivateDigestSourceRouteBinding;
  }): Result<PrivateDigestSourceCursorClaims, PrivateDigestSourceError>;
  createMessageRef(claims: PrivateDigestSourceMessageReferenceClaims): string;
}

export interface PrivateDigestSourceRawPage {
  messages: PrivateWhatsAppMessage[];
  sourceRevision: string;
  highWatermark: string | null;
  nextCursor: string | null;
}

export interface PrivateWhatsAppDigestSourceRepository {
  queryMessages(
    input: QueryPrivateDigestMessagesInput
  ): Promise<Result<PrivateDigestSourceRawPage, PrivateDigestSourceError>>;
}
