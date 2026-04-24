/**
 * HTTP client implementation for linear-agent communication.
 *
 * Slim facade that composes endpoint modules from ./linear/linear-endpoints/*.
 * Each module returns a partial of LinearAgentClient; the facade merges them
 * into the full client.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 207-308)
 */

import type { Logger } from '@intexuraos/common-core';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import { createIssueEndpoints } from './linear/linear-endpoints/issues.js';
import { createIssueTreeEndpoints } from './linear/linear-endpoints/issue-tree.js';
import { createIssueMetadataEndpoints } from './linear/linear-endpoints/issue-metadata.js';
import { createCommentEndpoints } from './linear/linear-endpoints/comments.js';

export interface LinearAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  timeoutMs: number;
}

export function createLinearAgentHttpClient(
  config: LinearAgentHttpClientConfig,
  logger: Logger
): LinearAgentClient {
  const deps = {
    baseUrl: config.baseUrl,
    internalAuthToken: config.internalAuthToken,
    timeoutMs: config.timeoutMs,
    logger,
  };

  return {
    ...createIssueEndpoints(deps),
    ...createIssueTreeEndpoints(deps),
    ...createIssueMetadataEndpoints(deps),
    ...createCommentEndpoints(deps),
  };
}
