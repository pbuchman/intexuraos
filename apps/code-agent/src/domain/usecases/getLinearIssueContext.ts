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

export type GetLinearIssueContextResult =
  | { status: 'ok'; data: LinearIssueContextResponse }
  | { status: 'not_found' }
  | { status: 'error'; code: string };

export async function getLinearIssueContext(
  identifier: string,
  deps: GetLinearIssueContextDeps
): Promise<GetLinearIssueContextResult> {
  const { linearAgentClient, logger } = deps;

  const result = await linearAgentClient.getIssueContext({ identifier });
  if (!result.ok) {
    if (result.error.code === 'NOT_FOUND') {
      return { status: 'not_found' };
    }
    logger.warn(
      { identifier, error: result.error },
      'Failed to fetch issue context from linear-agent'
    );
    return { status: 'error', code: result.error.code };
  }

  const context: IssueContext = result.value;
  // null→undefined: PlanResolutionContext expects `string | undefined`, not `string | null`.
  // undefined→null: our response contract uses `string | null` for JSON serializability.
  const planDocumentPath = resolvePlanDocumentPathFromLinearContext({
    description: context.description ?? undefined,
    comments: context.comments,
  }) ?? null;

  return {
    status: 'ok',
    data: {
      description: context.description,
      comments: context.comments,
      planDocumentPath,
    },
  };
}
