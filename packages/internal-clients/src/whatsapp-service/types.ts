import type { Result } from '@intexuraos/common-core';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';

export interface WhatsAppServiceClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export type PrivateMatrixDeliveryStatus =
  | { status: 'ready'; deliverable: true }
  | { status: 'setup_required'; deliverable: false; reason: string }
  | { status: 'error'; deliverable: false; message: string };

export interface SendPrivateOutboundMatrixMessageRequest {
  userId: string;
  text: string;
  startNewSession?: boolean;
  idempotencyKey?: string;
}

export type SendPrivateOutboundMatrixMessageResult =
  | { status: 'sent'; matrixEventId: string }
  | { status: 'setup_required'; reason: string }
  | { status: 'error'; message: string };

export interface WhatsAppServiceClient {
  getPrivateMatrixDeliveryStatus(userId: string): Promise<Result<PrivateMatrixDeliveryStatus>>;

  sendPrivateOutboundMatrixMessage(
    request: SendPrivateOutboundMatrixMessageRequest
  ): Promise<Result<SendPrivateOutboundMatrixMessageResult>>;
}
