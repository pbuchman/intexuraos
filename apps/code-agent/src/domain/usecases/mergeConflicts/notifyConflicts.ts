import type { Logger } from '@intexuraos/common-core';
import type { GitHubPRClient } from '../../ports/gitHubPRClient.js';
import { buildCodeTaskUrl } from '../../utils/taskUrls.js';

export type ConflictCommentPhase =
  | 'starting'
  | 'queued'
  | 'no-worker'
  | 'failed'
  | 'resolved';

export function buildTaskUrl(taskId: string): string {
  return buildCodeTaskUrl(taskId);
}

export function buildConflictCommentBody(params: {
  phase: ConflictCommentPhase;
  repository: string;
  prNumber: number;
  baseBranch: string;
  taskId?: string;
}): string {
  const lines = [
    '<!-- intexuraos:merge-conflict:v1 -->',
    '### Merge Conflict Detected',
    '',
    `PR #${String(params.prNumber)} in \`${params.repository}\` no longer merges cleanly into \`${params.baseBranch}\`.`,
  ];

  if (params.phase === 'resolved') {
    lines.push('', `The merge conflict with \`${params.baseBranch}\` appears to be resolved.`);
    return lines.join('\n');
  }

  if (params.taskId !== undefined) {
    lines.push('', `Task: [${params.taskId}](${buildTaskUrl(params.taskId)})`);
  }

  switch (params.phase) {
    case 'starting':
      lines.push('', 'Automated conflict resolution has started.');
      break;
    case 'queued':
      lines.push('', 'Automated conflict resolution is queued and will start when worker capacity is available.');
      break;
    case 'no-worker':
      lines.push('', 'Automatic resolution could not start because the PR owner has no enabled worker mapping.');
      break;
    case 'failed':
      lines.push('', 'Automatic resolution could not be started. A future push will retry the workflow.');
      break;
  }

  return lines.join('\n');
}

export async function updateManagedComment(
  gitHubPRClient: Pick<GitHubPRClient, 'postPRComment' | 'updateIssueComment'>,
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  existingCommentId: number | null,
  body: string,
  logger: Logger
): Promise<number | null> {
  if (existingCommentId !== null) {
    const updateResult = await gitHubPRClient.updateIssueComment(token, owner, repo, existingCommentId, body);
    if (updateResult.ok) {
      return updateResult.value.commentId;
    }

    logger.warn({ error: updateResult.error, existingCommentId }, 'Failed to update managed conflict comment');
  }

  const createResult = await gitHubPRClient.postPRComment(token, owner, repo, prNumber, body);
  if (!createResult.ok) {
    logger.warn({ error: createResult.error, prNumber }, 'Failed to create managed conflict comment');
    return null;
  }

  return createResult.value.commentId;
}
