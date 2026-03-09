import { readFile, glob } from 'node:fs/promises';
import { join } from 'node:path';
import { getErrorMessage, type Logger } from '@intexuraos/common-core';

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
