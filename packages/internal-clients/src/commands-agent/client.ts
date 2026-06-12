import {
  createInternalHttpClient,
  type InternalHttpClientResult,
} from '../shared/createInternalHttpClient.js';
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

export function createCommandsAgentServiceClient(
  config: CommandsAgentServiceConfig
): CommandsAgentServiceClient {
  const httpClient = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
  });

  return {
    async getCommand(
      commandId: string,
      options?: CommandsAgentRequestOptions
    ): Promise<InternalHttpClientResult<CommandWithText | null>> {
      const result = await httpClient.request<{ command?: unknown }>({
        path: `/internal/commands/${commandId}`,
        method: 'GET',
        extraHeaders: { 'Content-Type': 'application/json' },
        timeoutMs: options?.timeoutMs ?? config.defaultTimeoutMs,
        requestId: options?.requestId,
      });

      if (result.ok) {
        const command = normalizeCommand(result.value.command);
        if (command === null) {
          return {
            ok: false,
            error: {
              code: 'MALFORMED_ENVELOPE' as const,
              message: 'Invalid response from commands-agent',
            },
          };
        }

        return { ok: true, value: command } as const;
      }

      if (result.error.code === 'API_ERROR' && result.error.status === 404) {
        return { ok: true, value: null } as const;
      }

      if (result.error.code === 'API_ERROR') {
        return {
          ok: false,
          error: {
            code: 'API_ERROR' as const,
            message: `HTTP ${String(result.error.status)}: Failed to fetch command`,
            status: result.error.status,
            statusText: result.error.statusText,
            rawText: result.error.rawText,
            body: result.error.body,
          },
        };
      }

      if (result.error.code === 'ENVELOPE_ERROR' || result.error.code === 'MALFORMED_ENVELOPE') {
        return {
          ok: false,
          error: {
            code: result.error.code,
            message: 'Invalid response from commands-agent',
          },
        };
      }

      return { ok: false, error: result.error } as const;
    },
  };
}
