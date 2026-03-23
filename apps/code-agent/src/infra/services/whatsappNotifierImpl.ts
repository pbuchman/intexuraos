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
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';

const APP_BASE_URL = 'https://intexuraos.cloud';

export function buildTaskUrl(taskId: string): string {
  return `${APP_BASE_URL}/#/code-tasks/${taskId}`;
}

function buildCtaUrl(task: CodeTask): { displayText: string; url: string } {
  const prUrl = task.result?.prUrl;
  if (prUrl !== undefined && prUrl.length > 0) {
    return { displayText: 'View Pull Request', url: prUrl };
  }
  return { displayText: 'View Progress', url: buildTaskUrl(task.id) };
}

export interface WhatsAppNotifierConfig {
  whatsappPublisher: WhatsAppSendPublisher;
  linearAgentClient?: LinearAgentClient;
}

function summarizeTask(task: CodeTask): string {
  return task.prompt.slice(0, 50);
}

async function resolveTaskTitle(
  linearAgentClient: LinearAgentClient | undefined,
  userId: string,
  task: CodeTask
): Promise<string> {
  if (linearAgentClient !== undefined && task.linearIssueId !== undefined) {
    const linearResult = await linearAgentClient.fetchIssueForDisplay({
      userId,
      identifier: task.linearIssueId,
    });
    if (linearResult.ok) {
      return linearResult.value.title;
    }
  }

  return summarizeTask(task);
}

function formatCompletionMessage(title: string, task: CodeTask, linearIssueId?: string): string {
  const idPrefix = linearIssueId !== undefined ? `${linearIssueId} | ` : '';
  const result = task.result;
  if (!result) {
    return `✅ ${idPrefix}${title}`;
  }

  const branchLine = result.branch !== undefined ? `Branch: ${result.branch}\n` : '';
  const commitsLine = result.commits !== undefined ? `Commits: ${String(result.commits)}\n` : '';
  const summaryLine = result.summary ?? '';
  return `✅ ${idPrefix}${title}

${branchLine}${commitsLine}${summaryLine}`;
}

function formatFailureMessage(title: string, error: TaskError, linearIssueId?: string): string {
  const idPrefix = linearIssueId !== undefined ? `${linearIssueId} | ` : '';
  const remedation = error.remediation?.manualSteps !== undefined &&
    error.remediation.manualSteps.length > 0
    ? `\nSuggestion: ${error.remediation.manualSteps}`
    : '';

  return `❌ ${idPrefix}${title}

Error: ${error.message}${remedation}`;
}

function formatStartedMessage(title: string, _task: CodeTask, linearIssueId?: string): string {
  const idPrefix = linearIssueId !== undefined ? `${linearIssueId} | ` : '';
  return `🚀 ${idPrefix}${title}`;
}

function formatResumedMessage(title: string, _task: CodeTask, linearIssueId?: string): string {
  const idPrefix = linearIssueId !== undefined ? `${linearIssueId} | ` : '';
  return `🔄 ${idPrefix}${title}`;
}

function formatResumedCompletionMessage(title: string, task: CodeTask, linearIssueId?: string): string {
  const idPrefix = linearIssueId !== undefined ? `${linearIssueId} | ` : '';
  const result = task.result;
  if (!result) {
    return `🔁 ${idPrefix}${title}`;
  }

  const summaryLine = result.summary ?? '';
  return `🔁 ${idPrefix}${title}

${summaryLine}`;
}

function formatDesignCompleteMessage(
  title: string,
  task: CodeTask,
  includeButtonPrompt: boolean,
  linearIssueId?: string
): string {
  const idPrefix = linearIssueId !== undefined ? `${linearIssueId} | ` : '';
  const result = task.result;
  const summary = result?.summary ?? 'Design completed and ready for implementation.';

  const buttonPrompt = includeButtonPrompt
    ? '\n\nReady to implement? Click the button below to start Phase 2.'
    : '\n\nReady to implement? Open the web app to start Phase 2.';

  return `🎨 ${idPrefix}${title}

${summary}${buttonPrompt}`;
}

/**
 * Factory function to create WhatsAppNotifier.
 */
export function createWhatsAppNotifier(config: WhatsAppNotifierConfig): WhatsAppNotifier {
  const { whatsappPublisher, linearAgentClient } = config;

  return {
    async notifyTaskComplete(
      userId: string,
      task: CodeTask
    ): Promise<Result<void, NotificationError>> {
      const title = await resolveTaskTitle(linearAgentClient, userId, task);
      const message = formatCompletionMessage(title, task, task.linearIssueId);

      const prUrl = task.result?.prUrl;
      const publishParams: Parameters<typeof whatsappPublisher.publishSendMessage>[0] = {
        userId,
        message,
        ctaUrl: buildCtaUrl(task),
        correlationId: task.traceId,
      };
      if (prUrl !== undefined && prUrl.length > 0) {
        publishParams.ctaUrl = { displayText: 'View Pull Request', url: prUrl };
      }

      const result = await whatsappPublisher.publishSendMessage(publishParams);

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
      const title = await resolveTaskTitle(linearAgentClient, userId, task);
      const message = formatFailureMessage(title, error, task.linearIssueId);

      const result = await whatsappPublisher.publishSendMessage({
        userId,
        message,
        ctaUrl: { displayText: 'View Task', url: buildTaskUrl(task.id) },
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
      const title = await resolveTaskTitle(linearAgentClient, userId, task);
      const message = formatStartedMessage(title, task, task.linearIssueId);

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

      const result = await whatsappPublisher.publishSendMessage({
        userId,
        message,
        buttons,
        ctaUrl: { displayText: 'View Progress', url: buildTaskUrl(task.id) },
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
      const title = await resolveTaskTitle(linearAgentClient, userId, task);
      const message = formatResumedMessage(title, task, task.linearIssueId);

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

      const result = await whatsappPublisher.publishSendMessage({
        userId,
        message,
        buttons,
        ctaUrl: { displayText: 'View Progress', url: buildTaskUrl(task.id) },
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

    async notifyResumedTaskComplete(
      userId: string,
      task: CodeTask
    ): Promise<Result<void, NotificationError>> {
      const title = await resolveTaskTitle(linearAgentClient, userId, task);
      const message = formatResumedCompletionMessage(title, task, task.linearIssueId);

      const prUrl = task.result?.prUrl;
      const resumedPublishParams: Parameters<typeof whatsappPublisher.publishSendMessage>[0] = {
        userId,
        message,
        ctaUrl: buildCtaUrl(task),
        correlationId: task.traceId,
      };
      if (prUrl !== undefined && prUrl.length > 0) {
        resumedPublishParams.ctaUrl = { displayText: 'View Pull Request', url: prUrl };
      }

      const result = await whatsappPublisher.publishSendMessage(resumedPublishParams);

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
      const title = await resolveTaskTitle(linearAgentClient, userId, task);
      const message = formatDesignCompleteMessage(title, task, true, task.linearIssueId);

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
          const fallbackMessage = formatDesignCompleteMessage(title, task, false, task.linearIssueId);
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
      position: number
    ): Promise<Result<void, NotificationError>> {
      const title = await resolveTaskTitle(linearAgentClient, userId, task);
      const idPrefix = task.linearIssueId !== undefined ? `${task.linearIssueId} | ` : '';
      const message = `🕐 ${idPrefix}${title}
Queued. Position: ${String(position)}`;

      const result = await whatsappPublisher.publishSendMessage({
        userId,
        message,
        ctaUrl: { displayText: 'View Progress', url: buildTaskUrl(task.id) },
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
      const title = await resolveTaskTitle(linearAgentClient, userId, task);
      const idPrefix = task.linearIssueId !== undefined ? `${task.linearIssueId} | ` : '';
      const message = `⏰ ${idPrefix}${title}

Workers were still busy and the task timed out. Please retry when workers are available.`;

      const result = await whatsappPublisher.publishSendMessage({
        userId,
        message,
        ctaUrl: { displayText: 'View Progress', url: buildTaskUrl(task.id) },
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

    async notifyDispatchRetryExhausted(
      userId: string,
      info: { repository: string; pullRequestNumber: number; lastError: string }
    ): Promise<Result<void, NotificationError>> {
      const message = `⚠️ Dispatch retry failed: ${info.repository}#${String(info.pullRequestNumber)}

All retry attempts exhausted. The message could not be delivered to the worker.

Error: ${info.lastError}

Please check worker availability and retry manually if needed.`;

      const result = await whatsappPublisher.publishSendMessage({
        userId,
        message,
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
