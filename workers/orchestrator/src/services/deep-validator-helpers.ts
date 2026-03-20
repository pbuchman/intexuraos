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

export async function readPlanReferencedInLinearIssue(
  worktreePath: string,
  context: LinearIssueContext,
  logger: Logger
): Promise<string | undefined> {
  const planPath = resolvePlanDocumentPathFromLinearContext(context);
  if (planPath === undefined) return undefined;

  try {
    return await readFile(join(worktreePath, planPath), 'utf-8');
  } catch (error) {
    logger.warn(
      { worktreePath, planPath, error: getErrorMessage(error) },
      'Failed to read plan referenced in Linear issue'
    );
    return undefined;
  }
}

function getTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

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

export async function fetchLinearIssueDescription(
  identifier: string,
  apiKey: string,
  logger: Logger,
  timeoutMs = 10_000
): Promise<string | undefined> {
  const context = await fetchLinearIssueContext(identifier, apiKey, logger, timeoutMs);
  return context?.description;
}
