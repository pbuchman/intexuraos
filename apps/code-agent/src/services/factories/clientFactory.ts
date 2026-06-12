/**
 * Client factory for code-agent.
 *
 * Constructs external-service HTTP clients (linear-agent, actions-agent,
 * user-service, usage-service, GitHub) and exposes the `buildUsageSink`
 * helper used by downstream LLM factories.
 */

import type { Logger } from 'pino';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import {
  createUsageServiceClient,
  createUserServiceClient,
  type UsageServiceClient,
  type UserServiceClient,
} from '@intexuraos/internal-clients';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createGitHubPRHttpClient } from '../../infra/http/gitHubPRHttpClient.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { E2EMocks } from './e2eMocks.js';
import type { ServiceConfig } from '../types.js';

export interface ClientFactoryDeps {
  config: ServiceConfig;
  logger: Logger;
  isE2eMode: boolean;
  e2eMocks: E2EMocks;
}

export interface ClientServices {
  linearAgentClient: LinearAgentClient;
  actionsAgentClient: ActionsAgentClient;
  userServiceClient: UserServiceClient;
  usageServiceClient?: UsageServiceClient;
  gitHubPRClient: GitHubPRClient;
  buildUsageSink: (component: string) => HttpInternalAuthUsageSink;
}

/**
 * Create the HTTP/client services used by code-agent.
 *
 * When `isE2eMode` is true, Linear and actions-agent clients come from
 * `e2eMocks` so no real network I/O happens. `usageServiceClient` is
 * `undefined` when `llmUsageServiceUrl` is empty (i.e., usage tracking off).
 */
export function createClientServices(deps: ClientFactoryDeps): ClientServices {
  const { config, logger, isE2eMode, e2eMocks } = deps;

  const linearAgentClient = isE2eMode
    ? e2eMocks.linearAgentClient
    : createLinearAgentHttpClient({
        baseUrl: config.linearAgentUrl,
        internalAuthToken: config.internalAuthToken,
        timeoutMs: 60000,
      }, logger);

  const actionsAgentClient = isE2eMode
    ? e2eMocks.actionsAgentClient
    : createActionsAgentClient({
        baseUrl: config.actionsAgentUrl,
        internalAuthToken: config.internalAuthToken,
        logger,
      });

  const buildUsageSink = (component: string): HttpInternalAuthUsageSink =>
    new HttpInternalAuthUsageSink({
      usageServiceUrl: config.llmUsageServiceUrl,
      internalAuthToken: config.internalAuthToken,
      service: 'code-agent',
      component,
      logger,
    });

  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    logger,
    usageSink: buildUsageSink('user-service-client'),
  });

  const usageServiceClient = config.llmUsageServiceUrl !== ''
    ? createUsageServiceClient({
        baseUrl: config.llmUsageServiceUrl,
        internalAuthToken: config.internalAuthToken,
        logger,
      })
    : undefined;

  const gitHubPRClient = createGitHubPRHttpClient({ timeoutMs: 10000 });

  return {
    linearAgentClient,
    actionsAgentClient,
    userServiceClient,
    ...(usageServiceClient !== undefined && { usageServiceClient }),
    gitHubPRClient,
    buildUsageSink,
  };
}
