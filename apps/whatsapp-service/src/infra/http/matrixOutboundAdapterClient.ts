import { getErrorMessage } from '@intexuraos/common-core';
import type {
  MatrixOutboundGateway,
  MatrixOutboundReadinessInput,
  MatrixOutboundReadinessResult,
  MatrixOutboundSendInput,
  MatrixOutboundSendResult,
} from '../../domain/whatsapp/ports/matrixOutboundGateway.js';

interface MatrixOutboundAdapterClientConfig {
  baseUrl: string;
  authToken: string;
  fetchImpl?: typeof fetch;
}

interface MatrixAdapterReadinessResponse {
  status?: 'ready' | 'setup_required';
  reason?: string;
}

interface MatrixAdapterSendResponse {
  status?: 'sent' | 'setup_required';
  matrixEventId?: string;
  reason?: string;
}

function joinPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function hasConfig(config: MatrixOutboundAdapterClientConfig): boolean {
  return config.baseUrl !== '' && config.authToken !== '';
}

function getConfigurationErrorMessage(): string {
  return 'Matrix outbound adapter is not configured';
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createMatrixOutboundAdapterClient(
  config: MatrixOutboundAdapterClientConfig
): MatrixOutboundGateway {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async getDeliveryReadiness(
      input: MatrixOutboundReadinessInput
    ): Promise<MatrixOutboundReadinessResult> {
      if (!hasConfig(config)) {
        return {
          status: 'setup_required',
          reason: getConfigurationErrorMessage(),
        };
      }

      try {
        const response = await fetchImpl(
          joinPath(
            config.baseUrl,
            `/internal/matrix/outbound/readiness/${encodeURIComponent(input.sourceAccountId)}/${encodeURIComponent(input.target)}`
          ),
          {
            method: 'GET',
            headers: {
              authorization: `Bearer ${config.authToken}`,
            },
          }
        );
        const body = (await parseJsonResponse(response)) as MatrixAdapterReadinessResponse | null;

        if (!response.ok) {
          return {
            status: 'error',
            message: `Matrix adapter readiness request failed with HTTP ${String(response.status)}`,
          };
        }

        if (body?.status === 'ready') {
          return { status: 'ready' };
        }

        if (body?.status === 'setup_required' && typeof body.reason === 'string') {
          return {
            status: 'setup_required',
            reason: body.reason,
          };
        }

        return {
          status: 'error',
          message: 'Matrix adapter readiness response was invalid',
        };
      } catch (error) {
        return {
          status: 'error',
          message: getErrorMessage(error, 'Matrix adapter readiness request failed'),
        };
      }
    },

    async sendMessage(input: MatrixOutboundSendInput): Promise<MatrixOutboundSendResult> {
      if (!hasConfig(config)) {
        return {
          status: 'setup_required',
          reason: getConfigurationErrorMessage(),
        };
      }

      try {
        const response = await fetchImpl(
          joinPath(config.baseUrl, '/internal/matrix/outbound/messages'),
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${config.authToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              sourceAccountId: input.sourceAccountId,
              target: input.target,
              text: input.text,
              ...(input.idempotencyKey !== undefined
                ? { idempotencyKey: input.idempotencyKey }
                : {}),
            }),
          }
        );
        const body = (await parseJsonResponse(response)) as MatrixAdapterSendResponse | null;

        if (!response.ok) {
          return {
            status: 'error',
            message: `Matrix adapter send request failed with HTTP ${String(response.status)}`,
          };
        }

        if (body?.status === 'sent' && typeof body.matrixEventId === 'string') {
          return {
            status: 'sent',
            matrixEventId: body.matrixEventId,
          };
        }

        if (body?.status === 'setup_required' && typeof body.reason === 'string') {
          return {
            status: 'setup_required',
            reason: body.reason,
          };
        }

        return {
          status: 'error',
          message: 'Matrix adapter send response was invalid',
        };
      } catch (error) {
        return {
          status: 'error',
          message: getErrorMessage(error, 'Matrix adapter send request failed'),
        };
      }
    },
  };
}
