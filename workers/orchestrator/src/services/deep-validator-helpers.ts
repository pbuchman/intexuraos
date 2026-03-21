import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getErrorMessage,
  resolvePlanDocumentPathFromLinearContext,
  type Logger,
} from '@intexuraos/common-core';

export { resolvePlanDocumentPathFromLinearContext };

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

export interface LinearIssueComment {
  body: string;
  createdAt: string;
}

export interface LinearIssueContext {
  description: string | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes: callers must always provide the key
  comments: LinearIssueComment[];
}

export function extractPrNumber(prUrl: string | undefined): number | undefined {
  if (prUrl === undefined) return undefined;
  const match = /\/pull\/(\d+)/.exec(prUrl);
  return match?.[1] !== undefined ? parseInt(match[1], 10) : undefined;
}

export async function readPlanFile(
  worktreePath: string,
  planPath: string,
  logger: Logger
): Promise<string | undefined> {
  try {
    return await readFile(join(worktreePath, planPath), 'utf-8');
  } catch (error) {
    logger.warn(
      { worktreePath, planPath, error: getErrorMessage(error) },
      'Failed to read plan file from worktree'
    );
    return undefined;
  }
}

export async function readPlanReferencedInLinearIssue(
  worktreePath: string,
  context: LinearIssueContext,
  logger: Logger
): Promise<string | undefined> {
  const planPath = resolvePlanDocumentPathFromLinearContext(context);
  if (planPath === undefined) return undefined;
  return await readPlanFile(worktreePath, planPath, logger);
}

export interface CodeAgentIssueContext {
  description: string | null;
  comments: { body: string; createdAt: string }[];
  planDocumentPath: string | null;
}

export interface CodeAgentClientConfig {
  codeAgentUrl: string;
  internalAuthToken: string;
  timeoutMs?: number;
}

export async function fetchLinearIssueContextViaCodeAgent(
  identifier: string,
  config: CodeAgentClientConfig,
  logger: Logger
): Promise<CodeAgentIssueContext | undefined> {
  const { codeAgentUrl, internalAuthToken, timeoutMs = 10_000 } = config;
  try {
    const url = `${codeAgentUrl}/internal/linear/issue-context/${encodeURIComponent(identifier)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Internal-Auth': internalAuthToken,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      logger.warn(
        { identifier, status: response.status },
        'Failed to fetch Linear issue context via code-agent'
      );
      return undefined;
    }

    const body = (await response.json()) as {
      description?: string | null;
      comments?: { body?: string; createdAt?: string }[];
      planDocumentPath?: string | null;
    };

    return {
      description: body.description ?? null,
      comments: (body.comments ?? []).map((c) => ({
        body: c.body ?? '',
        createdAt: c.createdAt ?? '',
      })),
      planDocumentPath: body.planDocumentPath ?? null,
    };
  } catch (error) {
    logger.warn(
      { identifier, error: getErrorMessage(error) },
      'Failed to fetch Linear issue context via code-agent'
    );
    return undefined;
  }
}

function getTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** @deprecated Use fetchLinearIssueContextViaCodeAgent instead (INT-1040) */
export async function fetchLinearIssueContext(
  identifier: string,
  apiKey: string,
  logger: Logger,
  timeoutMs = 10_000
): Promise<LinearIssueContext | undefined> {
  try {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        query: `query IssueByIdentifier($id: String!) {
          issueByIdentifier(identifier: $id) {
            description
            comments(first: 100) {
              nodes {
                body
                createdAt
              }
            }
          }
        }`,
        variables: { id: identifier },
      }),
    });

    if (!response.ok) {
      logger.warn(
        { identifier, status: response.status },
        'Failed to fetch Linear issue context: non-OK status'
      );
      return undefined;
    }

    const body = (await response.json()) as {
      data?: {
        issueByIdentifier?: {
          description?: string | null;
          comments?: {
            nodes?:
              | {
                  body?: string | null;
                  createdAt?: string | null;
                }[]
              | null;
          } | null;
        };
      };
    };

    const issue = body.data?.issueByIdentifier;
    if (issue === undefined) return undefined;

    const comments = (issue.comments?.nodes ?? [])
      .flatMap((comment) => {
        const commentBody = comment.body;
        if (commentBody === undefined || commentBody === null || commentBody.trim() === '') {
          return [];
        }

        return [
          {
            body: commentBody,
            createdAt: comment.createdAt ?? '',
          },
        ];
      })
      .sort((left, right) => getTimestamp(right.createdAt) - getTimestamp(left.createdAt));

    return {
      description: issue.description ?? undefined,
      comments,
    };
  } catch (error) {
    logger.warn(
      { identifier, error: getErrorMessage(error) },
      'Failed to fetch Linear issue context'
    );
    return undefined;
  }
}

/** @deprecated Use fetchLinearIssueContextViaCodeAgent instead (INT-1040) */
export async function fetchLinearIssueDescription(
  identifier: string,
  apiKey: string,
  logger: Logger,
  timeoutMs = 10_000
): Promise<string | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- both functions are deprecated together (INT-1040)
  const context = await fetchLinearIssueContext(identifier, apiKey, logger, timeoutMs);
  return context?.description;
}
