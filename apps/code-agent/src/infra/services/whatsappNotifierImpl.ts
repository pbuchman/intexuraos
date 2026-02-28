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
  const branchLine = result.branch !== undefined ? `Branch: ${result.branch}\n` : '';
  const commitsLine = result.commits !== undefined ? `Commits: ${String(result.commits)}\n` : '';
  const summaryLine = result.summary ?? '';
  return `✅ Code task completed: ${title}

${prLine}${branchLine}${commitsLine}${summaryLine}${fallbackWarning}`;
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
 * Format task resumed notification message.
 */
function formatResumedMessage(task: CodeTask): string {
  const title = task.linearIssueTitle ?? task.prompt.slice(0, 50);
  return `🔄 Code task resumed: ${title}

Task ID: ${task.id}
Repository: ${task.repository}
Branch: ${task.baseBranch}`;
}

/**
 * Format design complete notification message (Phase 1 completion).
 * INT-628
 */
function formatDesignCompleteMessage(task: CodeTask, includeButtonPrompt: boolean): string {
  /* v8 ignore start -- ts-type: defensive null check for optional Linear title @preserve */
  const title = task.linearIssueTitle ?? task.prompt.slice(0, 50);
  /* v8 ignore stop @preserve */
  const result = task.result;
  /* v8 ignore start -- ts-type: defensive null check for optional result summary @preserve */
  const summary = result?.summary ?? 'Design completed and ready for implementation.';
  /* v8 ignore stop @preserve */

  const buttonPrompt = includeButtonPrompt
    ? '\n\nReady to implement? Click the button below to start Phase 2.'
    : '\n\nReady to implement? Open the web app to start Phase 2.';

  return `🎨 Design ready: ${title}

${summary}${buttonPrompt}`;
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

    async notifyTaskResumed(
      userId: string,
      task: CodeTask
    ): Promise<Result<void, NotificationError>> {
      const message = formatResumedMessage(task);

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

    async notifyDesignComplete(
      userId: string,
      task: CodeTask
    ): Promise<Result<void, NotificationError>> {
      const message = formatDesignCompleteMessage(task, true);

      // Build interactive button to proceed to Phase 2 (INT-628)
      const buttons: { type: 'reply'; reply: { id: string; title: string } }[] = [
        {
          type: 'reply',
          reply: {
            id: `proceed-implementation:${task.id}`,
            title: '▶️ Implement',
          },
        },
      ];

      const result = await whatsappPublisher.publishSendMessage({
        userId,
        message,
        buttons,
        correlationId: task.traceId,
      });

      if (!result.ok) {
        // Graceful degradation: if buttons can't be sent, try without buttons (with corrected message)
        if (result.error.code === 'PUBLISH_FAILED') {
          const fallbackMessage = formatDesignCompleteMessage(task, false);
          const fallbackResult = await whatsappPublisher.publishSendMessage({
            userId,
            message: fallbackMessage,
            correlationId: task.traceId,
          });
          if (!fallbackResult.ok) {
            return err({
              code: 'notification_failed',
              message: fallbackResult.error.message,
            });
          }
          return ok(undefined);
        }
        return err({
          code: 'notification_failed',
          message: result.error.message,
        });
      }

      return ok(undefined);
    },

    async notifyTaskQueued(
      userId: string,
      task: CodeTask,
      position: number,
      estimatedWaitMinutes: number
    ): Promise<Result<void, NotificationError>> {
      const title = task.linearIssueTitle ?? task.prompt.slice(0, 50);
      const message = `🕐 Task queued: ${title}

All workers are busy. Your task is in the queue.

Position: ${String(position)}
Estimated wait: ~${String(estimatedWaitMinutes)} minutes

Task ID: ${task.id}`;

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

    async notifyTaskQueueExpired(
      userId: string,
      task: CodeTask
    ): Promise<Result<void, NotificationError>> {
      const title = task.linearIssueTitle ?? task.prompt.slice(0, 50);
      const message = `⏰ Task expired in queue: ${title}

Workers were still busy and the task timed out. Please retry when workers are available.

Task ID: ${task.id}`;

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
  };
}
