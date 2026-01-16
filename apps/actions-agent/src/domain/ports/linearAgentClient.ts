/**
 * Port for Linear Agent service communication.
 */

import type { Result } from '@intexuraos/common-core';

export interface ProcessLinearActionResponse {
  status: 'completed' | 'failed';
  resourceUrl?: string;
  issueIdentifier?: string;
  error?: string;
}

export interface LinearAgentClient {
  processAction(
    actionId: string,
    userId: string,
    text: string,
    summary?: string
  ): Promise<Result<ProcessLinearActionResponse>>;
}
