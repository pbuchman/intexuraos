import {
  resolvePlanDocumentPathFromLinearContext,
  type Logger,
} from '@intexuraos/common-core';
import type { LinearAgentClient, IssueContext } from '../ports/linearAgentClient.js';

export interface GetLinearIssueContextDeps {
  linearAgentClient: LinearAgentClient;
  logger: Logger;
}

export interface LinearIssueContextResponse {
  description: string | null;
  comments: { body: string; createdAt: string }[];
  planDocumentPath: string | null;
}

export async function getLinearIssueContext(
  identifier: string,
  deps: GetLinearIssueContextDeps
): Promise<LinearIssueContextResponse | undefined> {
  const { linearAgentClient, logger } = deps;

  const result = await linearAgentClient.getIssueContext({ identifier });
  if (!result.ok) {
    if (result.error.code === 'NOT_FOUND') {
      return undefined;
    }
    logger.warn(
      { identifier, error: result.error },
      'Failed to fetch issue context from linear-agent'
    );
    return undefined;
  }

  const context: IssueContext = result.value;
  const planDocumentPath = resolvePlanDocumentPathFromLinearContext({
    description: context.description ?? undefined,
    comments: context.comments,
  }) ?? null;

  return {
    description: context.description,
    comments: context.comments,
    planDocumentPath,
  };
}
