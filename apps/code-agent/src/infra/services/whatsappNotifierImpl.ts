/**
 * WhatsApp notifier implementation.
 *
 * Sends notifications via Pub/Sub to whatsapp-service.
 * Design reference: docs/designs/INT-156-code-action-type.md lines 97-100
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { WhatsAppNotifier, NotificationError } from '../../domain/services/whatsappNotifier.js';
import type { CodeTask, TaskError } from '../../domain/models/codeTask.js';

export interface WhatsAppNotifierConfig {
  whatsappPublisher: WhatsAppSendPublisher;
}

/**
 * Format completion notification message.
 */
function formatCompletionMessage(task: CodeTask): string {
  const title = task.linearIssueTitle ?? task.prompt.slice(0, 50);
  const fallbackWarning = task.linearFallback === true
    ? '\n⚠️ (Linear unavailable - no issue tracking)'
    : '';

  const result = task.result;
  if (!result) {
    return `✅ Code task completed: ${title}${fallbackWarning}`;
  }

  const prLine = result.prUrl !== undefined && result.prUrl.length > 0
    ? `PR: ${result.prUrl}\n`
    : '';
  return `✅ Code task completed: ${title}

${prLine}Branch: ${result.branch}
Commits: ${String(result.commits)}
${result.summary}${fallbackWarning}`;
}

/**
 * Format failure notification message.
 */
function formatFailureMessage(task: CodeTask, error: TaskError): string {
  const title = task.linearIssueTitle ?? task.prompt.slice(0, 50);
  const fallbackWarning = task.linearFallback === true
    ? '\n⚠️ (Linear unavailable - no issue tracking)'
    : '';

  const remedation = error.remediation?.manualSteps !== undefined &&
    error.remediation.manualSteps.length > 0
    ? `\nSuggestion: ${error.remediation.manualSteps}`
    : '';

  return `❌ Code task failed: ${title}

Error: ${error.message}${remedation}${fallbackWarning}`;
}

/**
 * Format task started notification message.
 */
function formatStartedMessage(task: CodeTask): string {
  const title = task.linearIssueTitle ?? task.prompt.slice(0, 50);
  return `🚀 Code task started: ${title}

Task ID: ${task.id}
Repository: ${task.repository}
Branch: ${task.baseBranch}`;
}

/**
 * Factory function to create WhatsAppNotifier.
 */
export function createWhatsAppNotifier(config: WhatsAppNotifierConfig): WhatsAppNotifier {
  const { whatsappPublisher } = config;

  return {
    async notifyTaskComplete(
      userId: string,
      task: CodeTask
    ): Promise<Result<void, NotificationError>> {
      const message = formatCompletionMessage(task);

      const result = await whatsappPublisher.publishSendMessage({
        userId,
        message,
        correlationId: task.traceId,
      });

      if (!result.ok) {
        return err({
          code: 'notification_failed',
          message: result.error.message,
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

      const result = await whatsappPublisher.publishSendMessage({
        userId,
        message,
        correlationId: task.traceId,
      });

      if (!result.ok) {
        return err({
          code: 'notification_failed',
          message: result.error.message,
        });
      }

      return ok(undefined);
    },

    async notifyTaskStarted(
      userId: string,
      task: CodeTask
    ): Promise<Result<void, NotificationError>> {
      const message = formatStartedMessage(task);

      // Build interactive buttons for task management (INT-379)
      // Cancel button includes nonce for security validation
      const buttons: { type: 'reply'; reply: { id: string; title: string } }[] = [];

      if (task.cancelNonce !== undefined) {
        buttons.push({
          type: 'reply',
          reply: {
            id: `cancel-task:${task.id}:${task.cancelNonce}`,
            title: '❌ Cancel Task',
          },
        });
      }

      buttons.push({
        type: 'reply',
        reply: {
          id: `view-task:${task.id}`,
          title: '👁️ View Progress',
        },
      });

      const result = await whatsappPublisher.publishSendMessage({
        userId,
        message,
        buttons,
        correlationId: task.traceId,
      });

      if (!result.ok) {
        return err({
          code: 'notification_failed',
          message: result.error.message,
        });
      }

      return ok(undefined);
    },
  };
}
