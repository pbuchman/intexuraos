/**
 * WhatsApp notifier implementation.
 *
 * Sends notifications via whatsapp-service internal API.
 * Design reference: docs/designs/INT-156-code-action-type.md lines 97-100
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { fetchWithAuth, type ServiceClientConfig } from '@intexuraos/internal-clients';
import type { WhatsAppNotifier, NotificationError } from '../../domain/services/whatsappNotifier.js';
import type { CodeTask, TaskError } from '../../domain/models/codeTask.js';

/**
 * Format completion notification message.
 */
function formatCompletionMessage(task: CodeTask): string {
  const title = task.linearIssueTitle ?? task.prompt.slice(0, 50);
  const fallbackWarning = task.linearFallback
    ? '\n⚠️ (Linear unavailable - no issue tracking)'
    : '';

  const result = task.result;
  if (!result) {
    return `✅ Code task completed: ${title}${fallbackWarning}`;
  }

  const prLine = result.prUrl ? `PR: ${result.prUrl}\n` : '';
  return `✅ Code task completed: ${title}

${prLine}Branch: ${result.branch}
Commits: ${result.commits}
${result.summary}${fallbackWarning}`;
}

/**
 * Format failure notification message.
 */
function formatFailureMessage(task: CodeTask, error: TaskError): string {
  const title = task.linearIssueTitle ?? task.prompt.slice(0, 50);
  const fallbackWarning = task.linearFallback
    ? '\n⚠️ (Linear unavailable - no issue tracking)'
    : '';

  const remedation = error.remediation?.manualSteps
    ? `\nSuggestion: ${error.remediation.manualSteps}`
    : '';

  return `❌ Code task failed: ${title}

Error: ${error.message}${remedation}${fallbackWarning}`;
}

/**
 * Factory function to create WhatsAppNotifier.
 */
export function createWhatsAppNotifier(config: ServiceClientConfig): WhatsAppNotifier {
  return {
    async notifyTaskComplete(
      userId: string,
      task: CodeTask
    ): Promise<Result<void, NotificationError>> {
      const message = formatCompletionMessage(task);

      const response = await fetchWithAuth(
        config,
        '/internal/messages/send',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId,
            message,
            type: 'code_task_complete',
          }),
        }
      );

      if (!response.ok) {
        return err({
          code: 'notification_failed',
          message: response.error?.message ?? 'Unknown error',
        });
      }

      return ok(undefined);
    },

    async notifyTaskFailed(
      userId: string,
      task: CodeTask,
      error: TaskError
    ): Promise<Result<void, NotificationError>> {
      const message = formatFailureMessage(task, error);

      const response = await fetchWithAuth(
        config,
        '/internal/messages/send',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId,
            message,
            type: 'code_task_failed',
          }),
        }
      );

      if (!response.ok) {
        return err({
          code: 'notification_failed',
          message: response.error?.message ?? 'Unknown error',
        });
      }

      return ok(undefined);
    },
  };
}
