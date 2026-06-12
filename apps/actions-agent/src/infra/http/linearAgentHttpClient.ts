import { createLinearAgentServiceClient } from '@intexuraos/internal-clients';
import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';

type LogMethod = (obj: unknown, msg?: string) => void;

interface HttpLogger {
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
}

export interface LinearAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: HttpLogger;
}

export function createLinearAgentHttpClient(
  config: LinearAgentHttpClientConfig
): LinearAgentClient {
  const client = createLinearAgentServiceClient(config);

  return {
    async processAction(
      actionId: string,
      userId: string,
      text: string,
      summary?: string
    ): Promise<Result<ServiceFeedback>> {
      return await client.processAction(
        actionId,
        userId,
        text,
        summary === undefined ? undefined : { summary }
      );
    },
  };
}
