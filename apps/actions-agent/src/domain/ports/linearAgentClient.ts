/**
 * Port for Linear Agent service communication.
 */

import type { Result, ServiceFeedback } from '@intexuraos/common-core';

export interface LinearAgentClient {
  processAction(
    actionId: string,
    userId: string,
    text: string,
    summary?: string
  ): Promise<Result<ServiceFeedback>>;
}
