import { err, ok, type Result } from '@intexuraos/common-core';
import { createInternalHttpClient } from '../shared/createInternalHttpClient.js';
import type {
  PrivateMatrixDeliveryStatus,
  SendPrivateOutboundMatrixMessageRequest,
  SendPrivateOutboundMatrixMessageResult,
  WhatsAppServiceClient,
  WhatsAppServiceClientConfig,
} from './types.js';

type WhatsAppClientResult<T> = Result<T>;

function invalidResponseError(): Error {
  return new Error('Invalid response from whatsapp-service');
}

async function parseResponse<T>(
  client: ReturnType<typeof createInternalHttpClient>,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<WhatsAppClientResult<T>> {
  const result = await client.request<T>({
    path,
    method,
    ...(body !== undefined ? { body } : {}),
  });

  if (result.ok) {
    return ok(result.value);
  }

  if (result.error.code === 'ENVELOPE_ERROR' || result.error.code === 'MALFORMED_ENVELOPE') {
    return err(invalidResponseError());
  }

  if (result.error.code === 'API_ERROR') {
    return err(new Error(`HTTP ${String(result.error.status)}: ${result.error.statusText}`));
  }

  return err(new Error(result.error.message));
}

export function createWhatsAppServiceClient(
  config: WhatsAppServiceClientConfig
): WhatsAppServiceClient {
  const client = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
  });

  return {
    async getPrivateMatrixDeliveryStatus(
      userId: string
    ): Promise<WhatsAppClientResult<PrivateMatrixDeliveryStatus>> {
      return await parseResponse<PrivateMatrixDeliveryStatus>(
        client,
        `/internal/whatsapp/private/matrix-delivery-status/${encodeURIComponent(userId)}`,
        'GET'
      );
    },

    async sendPrivateOutboundMatrixMessage(
      request: SendPrivateOutboundMatrixMessageRequest
    ): Promise<WhatsAppClientResult<SendPrivateOutboundMatrixMessageResult>> {
      return await parseResponse<SendPrivateOutboundMatrixMessageResult>(
        client,
        '/internal/whatsapp/private/outbound-matrix-messages',
        'POST',
        request
      );
    },
  };
}
