import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  ExternalSaveToolClient,
  ExternalSaveToolError,
  ExternalSaveToolInput,
  ExternalSaveToolResult,
} from '../../domain/agent/toolExecutor.js';

export interface ExternalSaveClientConfig {
  endpointUrl: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  source: string;
  fetchFn?: typeof fetch;
}

export function createExternalSaveClient(config: ExternalSaveClientConfig): ExternalSaveToolClient {
  const fetchFn = config.fetchFn ?? fetch;

  return {
    async save(input: ExternalSaveToolInput): Promise<Result<ExternalSaveToolResult, ExternalSaveToolError>> {
      try {
        const response = await fetchFn(config.endpointUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'CF-Access-Client-Id': config.cfAccessClientId,
            'CF-Access-Client-Secret': config.cfAccessClientSecret,
          },
          body: JSON.stringify({
            source: config.source,
            message: input.message,
            ...(input.sourceUrl !== undefined ? { source_url: input.sourceUrl } : {}),
          }),
        });

        if (!response.ok) {
          return err({
            code: 'HTTP_ERROR',
            message: `HTTP ${String(response.status)}: ${response.statusText}`,
          });
        }

        return ok({
          status: 'completed',
          message: 'Saved externally',
        });
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: getErrorMessage(error),
        });
      }
    },
  };
}
