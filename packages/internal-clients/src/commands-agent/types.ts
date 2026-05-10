import type { CommandsCommandWithText } from '@intexuraos/http-contracts';
import type {
  InternalHttpClientLogger,
  InternalHttpClientResult,
} from '../shared/createInternalHttpClient.js';

export interface CommandsAgentServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export interface CommandsAgentRequestOptions {
  requestId?: string;
  timeoutMs?: number;
}

export type CommandWithText = CommandsCommandWithText;

export interface CommandsAgentServiceClient {
  getCommand(
    commandId: string,
    options?: CommandsAgentRequestOptions
  ): Promise<InternalHttpClientResult<CommandWithText | null>>;
}
