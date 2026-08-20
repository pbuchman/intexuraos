import { getErrorMessage } from '@intexuraos/common-core';
import type { PromptBuilder } from '@intexuraos/llm-prompts';
import type { CreateTaskInput } from '../../repositories/codeTaskRepository.js';
import { generateWebhookSecret } from '../../utils/secrets.js';
import type {
  CIFailureDispatchContext,
  CIFailureDispatchResult,
  WebhookDispatchServiceDeps,
} from './types.js';
import {
  buildGitHubEventTaskId,
  reserveGitHubEventTask,
} from './eventTaskReservation.js';

export interface CIFixPromptInput {
  repository: string;
  prNumber: number;
  prUrl: string;
  checkName: string;
  branch: string;
  headSha: string;
}

/**
 * Execute the CI failure dispatch workflow: when a check run on a PR that was
 * created by a code-agent task fails, create a follow-up "fix" task linked to
 * the parent and notify the user.
 */
export async function executeCIFailureDispatch(
  deps: WebhookDispatchServiceDeps,
  context: CIFailureDispatchContext,
): Promise<CIFailureDispatchResult> {
  const { event, logger } = context;

  try {
    logger.info(
      { prNumber: event.pullRequestNumber, repo: event.repository, eventType: event.eventType },
      'Starting CI failure dispatch workflow'
    );

    // Find the original task that created this PR
    const taskResult = await deps.codeTaskRepo.findLatestExecutionTaskByPR(event.repository, event.pullRequestNumber);

    if (!taskResult.ok) {
      logger.error(
        { prNumber: event.pullRequestNumber, repo: event.repository, error: taskResult.error },
        'Failed to find original task for CI failure'
      );
      return { success: false, fixTaskCreated: false, error: `Failed to find task: ${taskResult.error.message}` };
    }

    const originalTask = taskResult.value;

    if (originalTask === null) {
      logger.info(
        { prNumber: event.pullRequestNumber, repo: event.repository },
        'No original task found for CI failure, skipping'
      );
      return { success: true, fixTaskCreated: false, skipped: true, skipReason: 'no_original_task' };
    }

    // Check loop prevention: only skip if this task was already a CI failure follow-up.
    // If it's a pr_comment or other follow-up whose PR failed CI, we should still
    // create a ci_failure follow-up (that's a different failure, not a loop).
    if (originalTask.followUpReason === 'ci_failure') {
      logger.info(
        { taskId: originalTask.id, prNumber: event.pullRequestNumber },
        'CI failure follow-up already exists, skipping to prevent loop'
      );
      return { success: true, fixTaskCreated: false, skipped: true, skipReason: 'already_follow_up' };
    }

    // Extract CI failure details from payload
    const payload = event.payload as Record<string, unknown> | null;
    const checkName = typeof payload?.['checkName'] === 'string' ? payload['checkName'] : 'Unknown Check';
    const headBranch = event.baseBranch ?? 'unknown';
    const headSha = typeof payload?.['headSha'] === 'string' ? payload['headSha'] : 'unknown';
    const checkSuiteId = typeof payload?.['checkSuiteId'] === 'number' ? payload['checkSuiteId'] : 0;
    /* v8 ignore start -- ts-type: typeof narrowing on unknown payload field — checkSuiteUrl fallback unreachable when payload always has string url @preserve */
    const checkSuiteUrl = typeof payload?.['checkSuiteUrl'] === 'string' ? payload['checkSuiteUrl'] : undefined;
    /* v8 ignore stop @preserve */

    const prUrl = `https://github.com/${event.repository}/pull/${String(event.pullRequestNumber)}`;
    // Build follow-up task prompt
    const fixPrompt = ciFixPrompt.build({
      repository: event.repository,
      prNumber: event.pullRequestNumber,
      prUrl,
      checkName,
      branch: headBranch,
      headSha,
    });

    // Create follow-up task
    const taskId = buildGitHubEventTaskId('ci-fix', event.id);
    const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, taskId);
    const createInput: CreateTaskInput = {
      id: taskId,
      userId: originalTask.userId,
      prompt: fixPrompt,
      sanitizedPrompt: fixPrompt,
      systemPromptHash: 'ci-failure-fix',
      workerType: originalTask.workerType,
      workerLocation: originalTask.workerLocation,
      repository: event.repository,
      baseBranch: event.baseBranch ?? originalTask.baseBranch,
      traceId: `ci-fix-${event.id}`,
      parentTaskId: originalTask.id,
      followUpReason: 'ci_failure',
      agentType: 'pull_request',
      initialStatus: 'queued',
      prNumber: event.pullRequestNumber,
      webhookSecret,
      ...(event.baseBranch !== null && { prBranch: event.baseBranch }),
      ...(originalTask.linearIssueId !== undefined && { linearIssueId: originalTask.linearIssueId }),
    };

    const createResult = await deps.firestore.runTransaction(async (transaction) =>
      await reserveGitHubEventTask({
        codeTaskRepo: deps.codeTaskRepo,
        transaction,
        taskInput: { ...createInput, id: taskId },
      }));

    if (!createResult.ok) {
      logger.error(
        { error: createResult.error, originalTaskId: originalTask.id },
        'Failed to create CI fix follow-up task'
      );
      return { success: false, fixTaskCreated: false, error: `Failed to create task: ${createResult.error.message}` };
    }

    const fixTaskId = createResult.value.task.id;

    if (!createResult.value.created) {
      logger.info(
        { eventId: event.id, fixTaskId, originalTaskId: originalTask.id },
        'CI failure event already owns a task; skipping duplicate side effects',
      );
      return {
        success: true,
        fixTaskCreated: true,
        parentTaskId: originalTask.id,
        fixTaskId,
      };
    }

    // Record ci_failure_detected only for the first reservation of this event.
    await deps.automationLog.record(
      { repository: event.repository, prNumber: event.pullRequestNumber },
      {
        type: 'ci_failure_detected',
        checkName,
        conclusion: 'failure',
        headBranch,
        headSha,
        checkSuiteId,
        prUrl,
      },
      originalTask.userId,
    ).catch((error: unknown) => {
      logger.warn({ error }, 'Failed to record ci_failure_detected in automation log');
    });

    // Record fix_task_dispatched in automation log
    await deps.automationLog.record(
      { repository: event.repository, prNumber: event.pullRequestNumber },
      {
        type: 'fix_task_dispatched',
        parentTaskId: originalTask.id,
        fixTaskId,
        checkName,
      },
      originalTask.userId,
    ).catch((error: unknown) => {
      logger.warn({ error }, 'Failed to record fix_task_dispatched in automation log');
    });

    // Enqueue the fix task
    await deps.taskEnqueueService.enqueue({ taskId: fixTaskId, userId: originalTask.userId }).catch((error: unknown) => {
      logger.warn({ error, fixTaskId }, 'Failed to enqueue CI fix task');
    });

    // Send WhatsApp notification
    await deps.whatsappNotifier.notifyCIFailure(originalTask.userId, {
      repository: event.repository,
      pullRequestNumber: event.pullRequestNumber,
      prUrl,
      checkName,
      branch: headBranch,
      taskId: originalTask.id,
      /* v8 ignore start -- ts-type: conditional spread on checkSuiteUrl !== undefined — fallback unreachable when upstream typeof narrowing guarantees string @preserve */
      ...(checkSuiteUrl !== undefined && { runUrl: checkSuiteUrl }),
      /* v8 ignore stop @preserve */
    }).catch((error: unknown) => {
      logger.warn({ error }, 'Failed to send CI failure WhatsApp notification');
    });

    logger.info(
      { originalTaskId: originalTask.id, fixTaskId, prNumber: event.pullRequestNumber },
      'CI failure follow-up task created'
    );

    return {
      success: true,
      fixTaskCreated: true,
      parentTaskId: originalTask.id,
      fixTaskId,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    logger.error(
      { prNumber: event.pullRequestNumber, repo: event.repository, error: errorMessage },
      'Unexpected error in CI failure dispatch workflow'
    );
    return { success: false, fixTaskCreated: false, error: `Unexpected error: ${errorMessage}` };
  }
}

/**
 * Build the prompt for a CI fix follow-up task.
 */
export const ciFixPrompt: PromptBuilder<CIFixPromptInput> = {
  name: 'ci-fix',
  description: 'Builds the follow-up task prompt for an automated CI failure fix',
  version: '1.0.0',

  build(input: CIFixPromptInput): string {
    return `## CI Failure Fix Task

### Context
A CI check failed on your agent's Pull Request.

### PR Details
- Repository: ${input.repository}
- PR Number: #${String(input.prNumber)}
- PR URL: ${input.prUrl}
- Branch: ${input.branch}
- Commit: ${input.headSha}

### Failing Check
${input.checkName}

### Instructions
1. First, check the GitHub Actions run to understand what failed:
   - Visit: ${input.prUrl}/checks
   - Look at the failing check's logs

2. The most common cause is coverage failures from missing test exemptions.
   If you see "uncovered branch" errors, add v8 ignore comments with valid exemptions.

3. Fix the issue in your code:
   - If it's a coverage issue, add v8 ignore comments with valid exemptions
   - If it's a lint error, fix the linting issues
   - If it's a type error, fix the TypeScript types

4. After fixing, run \`pnpm run ci:tracked\` locally to verify

5. Commit and push your fix

### Important Reminders
- Only fix the CI failure issue - do not make unrelated changes
- Add proper v8 ignore exemptions with specific categories and explanations
- Ensure all existing tests still pass
`;
  },
};
