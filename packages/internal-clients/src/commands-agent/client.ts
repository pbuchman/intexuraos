import { sendInternalRequest } from '../shared/request.js';
import type { InternalHttpClientResult } from '../shared/createInternalHttpClient.js';
import type {
  CommandWithText,
  CommandsAgentServiceClient,
  CommandsAgentServiceConfig,
  CommandsAgentRequestOptions,
} from './types.js';

function normalizeCommand(body: unknown): CommandWithText | null {
  if (body === null || typeof body !== 'object') {
    return null;
  }

  if (!('id' in body) || typeof body.id !== 'string') {
    return null;
  }
  if (!('text' in body) || typeof body.text !== 'string') {
    return null;
  }
  const bodyRecord = body as { id: string; text: string; sourceType?: unknown };

  return {
    id: bodyRecord.id,
    text: bodyRecord.text,
    sourceType: typeof bodyRecord.sourceType === 'string' ? bodyRecord.sourceType : '',
  };
}

interface CommandsGetCommandEnvelope {
  success?: boolean;
  data?: {
    command?: unknown;
  };
}

export function createCommandsAgentServiceClient(
  config: CommandsAgentServiceConfig
): CommandsAgentServiceClient {
  return {
    async getCommand(
      commandId: string,
      options?: CommandsAgentRequestOptions
    ): Promise<InternalHttpClientResult<CommandWithText | null>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: `/internal/commands/${commandId}`,
        method: 'GET',
        token: config.internalAuthToken,
        logger: config.logger,
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: options?.timeoutMs ?? config.defaultTimeoutMs,
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return { ok: false, error: transport.error } as const;
      }

      if (transport.response.status === 404) {
        return { ok: true, value: null } as const;
      }

      if (!transport.response.ok) {
        return {
          ok: false,
          error: {
            code: 'API_ERROR' as const,
            message: `HTTP ${String(transport.response.status)}: Failed to fetch command`,
            status: transport.response.status,
          },
        };
      }

      const body = transport.body as CommandsGetCommandEnvelope;
      const command = normalizeCommand(body.data?.command);
      if (body.success !== true || command === null) {
        return {
          ok: false,
          error: {
            code: 'MALFORMED_ENVELOPE' as const,
            message: 'Invalid response from commands-agent',
          },
        };
      }

      return { ok: true, value: command } as const;
    },
  };
}
