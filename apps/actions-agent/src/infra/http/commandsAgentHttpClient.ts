import { createCommandsAgentServiceClient } from '@intexuraos/internal-clients';
import type {
  CommandsAgentClient,
  CommandWithText,
} from '../../domain/ports/commandsAgentClient.js';

type LogMethod = (obj: unknown, msg?: string) => void;

interface HttpLogger {
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
}

export interface CommandsAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: HttpLogger;
}

export function createCommandsAgentHttpClient(
  config: CommandsAgentHttpClientConfig
): CommandsAgentClient {
  const client = createCommandsAgentServiceClient(config);

  return {
    async getCommand(commandId: string): Promise<CommandWithText | null> {
      const result = await client.getCommand(commandId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
  };
}
