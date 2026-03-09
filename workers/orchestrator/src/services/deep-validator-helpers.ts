import { readFile, glob } from 'node:fs/promises';
import { join } from 'node:path';
import { getErrorMessage, type Logger } from '@intexuraos/common-core';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

export function extractPrNumber(prUrl: string | undefined): number | undefined {
  if (prUrl === undefined) return undefined;
  const match = /\/pull\/(\d+)/.exec(prUrl);
  return match?.[1] !== undefined ? parseInt(match[1], 10) : undefined;
}

export async function findPlanOnBranch(
  worktreePath: string,
  logger: Logger
): Promise<string | undefined> {
  try {
    const pattern = join(worktreePath, 'docs', 'plans', '**', '*.md');
    const planFiles: string[] = [];
    for await (const filePath of glob(pattern)) {
      planFiles.push(filePath);
    }
    if (planFiles.length === 0) return undefined;

    // Sort by path (most recent date-prefixed plan last) and pick the last one
    planFiles.sort();
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess fallback, length check above guarantees element exists @preserve */
    return await readFile(planFiles[planFiles.length - 1] ?? '', 'utf-8');
    /* v8 ignore stop @preserve */
  } catch (error) {
    logger.warn({ worktreePath, error: getErrorMessage(error) }, 'Failed to find plan on branch');
    return undefined;
  }
}

export async function fetchLinearIssueDescription(
  identifier: string,
  apiKey: string,
  logger: Logger,
  timeoutMs = 10_000
): Promise<string | undefined> {
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
          issueByIdentifier(identifier: $id) { description }
        }`,
        variables: { id: identifier },
      }),
    });

    if (!response.ok) {
      logger.warn(
        { identifier, status: response.status },
        'Failed to fetch Linear issue description: non-OK status'
      );
      return undefined;
    }

    const body = (await response.json()) as {
      data?: { issueByIdentifier?: { description?: string | null } };
    };
    const description = body.data?.issueByIdentifier?.description;
    if (description === undefined || description === null) return undefined;
    return description;
  } catch (error) {
    logger.warn(
      { identifier, error: getErrorMessage(error) },
      'Failed to fetch Linear issue description'
    );
    return undefined;
  }
}
