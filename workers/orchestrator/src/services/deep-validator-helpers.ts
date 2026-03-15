import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { getErrorMessage, type Logger } from '@intexuraos/common-core';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
const PLAN_DOCUMENT_LINE_REGEX = /^Plan document:\s*(.+)$/gim;
const PLAN_DOCUMENT_PATH_REGEX = /docs\/plans\/[^\s)\]>'"]+?\.md\b/g;

export interface LinearIssueComment {
  body: string;
  createdAt: string;
}

export interface LinearIssueContext {
  description: string | undefined;
  comments: LinearIssueComment[];
}

export function extractPrNumber(prUrl: string | undefined): number | undefined {
  if (prUrl === undefined) return undefined;
  const match = /\/pull\/(\d+)/.exec(prUrl);
  return match?.[1] !== undefined ? parseInt(match[1], 10) : undefined;
}

function normalizePlanDocumentPath(candidate: string): string | undefined {
  const normalized = posix.normalize(candidate.trim());
  if (
    normalized.startsWith('/') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    !normalized.startsWith('docs/plans/') ||
    !normalized.endsWith('.md')
  ) {
    return undefined;
  }

  return normalized;
}

function extractPlanDocumentPathCandidate(text: string): string | undefined {
  for (const match of text.matchAll(PLAN_DOCUMENT_PATH_REGEX)) {
    const normalized = normalizePlanDocumentPath(match[0]);
    if (normalized !== undefined) return normalized;
  }

  return undefined;
}

function extractCanonicalPlanDocumentPath(text: string): string | undefined {
  const canonicalLineRegex = new RegExp(PLAN_DOCUMENT_LINE_REGEX);

  for (
    let match = canonicalLineRegex.exec(text);
    match !== null;
    match = canonicalLineRegex.exec(text)
  ) {
    const normalized = extractPlanDocumentPathCandidate(String(match[1]));
    if (normalized !== undefined) return normalized;
  }

  return undefined;
}

export function resolvePlanDocumentPathFromLinearContext(
  context: LinearIssueContext
): string | undefined {
  const description = context.description ?? '';

  const descriptionCanonical = extractCanonicalPlanDocumentPath(description);
  if (descriptionCanonical !== undefined) return descriptionCanonical;

  for (const comment of context.comments) {
    const commentCanonical = extractCanonicalPlanDocumentPath(comment.body);
    if (commentCanonical !== undefined) return commentCanonical;
  }

  const descriptionFallback = extractPlanDocumentPathCandidate(description);
  if (descriptionFallback !== undefined) return descriptionFallback;

  for (const comment of context.comments) {
    const commentFallback = extractPlanDocumentPathCandidate(comment.body);
    if (commentFallback !== undefined) return commentFallback;
  }

  return undefined;
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
