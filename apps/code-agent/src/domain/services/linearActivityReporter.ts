/**
 * Linear Activity Reporter.
 *
 * Maps task events to Linear agent activities, making execution
 * visible in the Linear UI. Uses Agent Plans to show Phase 1 / Phase 2
 * progress as a checklist.
 *
 * Key design decisions:
 * - Fire-and-forget: Linear API failures are logged but never fail the task
 * - Graceful skip: Tasks without agentSessionId skip all reporting
 * - Idempotent: Safe to call multiple times for the same event
 */

import type { Logger } from '@intexuraos/common-core';
import type { LinearAgentApiClient, ActivityType, PlanStep } from '../ports/linearAgentApiClient.js';

export type TaskEventType =
  | 'task_dispatched'
  | 'phase1_start'
  | 'phase1_complete'
  | 'phase2_start'
  | 'pr_created'
  | 'task_completed'
  | 'task_error'
  | 'task_timeout';

export interface TaskEvent {
  type: TaskEventType;
  sessionId?: string;
  details?: string;
  prUrl?: string;
}

export interface ActivityMapping {
  type: ActivityType;
  body: string;
}

/**
 * Map a task event to a Linear activity type and body.
 */
export function mapTaskEventToActivity(event: TaskEvent): ActivityMapping {
  switch (event.type) {
    case 'task_dispatched':
      return { type: 'action', body: 'Starting code execution...' };
    case 'phase1_start':
      return { type: 'thought', body: 'Analyzing requirements and preparing design...' };
    case 'phase1_complete':
      return {
        type: 'response',
        body: event.details ?? 'Issue enriched with requirements. Ready for Phase 2.',
      };
    case 'phase2_start':
      return { type: 'action', body: 'Implementing solution...' };
    case 'pr_created':
      return {
        type: 'response',
        body: event.prUrl !== undefined
          ? `Pull request created: [View PR](${event.prUrl})`
          : 'Pull request created.',
      };
    case 'task_completed':
      return {
        type: 'response',
        body: event.details ?? 'Task completed successfully.',
      };
    case 'task_error':
      return {
        type: 'error',
        body: event.details ?? 'Task execution failed.',
      };
    case 'task_timeout':
      return { type: 'error', body: 'Execution timed out.' };
  }
}

/**
 * Build the agent plan steps based on current phase.
 */
export function buildPlanSteps(currentEvent: TaskEventType): PlanStep[] {
  const phaseMap: Record<TaskEventType, number> = {
    task_dispatched: 0,
    phase1_start: 1,
    phase1_complete: 2,
    phase2_start: 3,
    pr_created: 4,
    task_completed: 5,
    task_error: -1,
    task_timeout: -1,
  };

  const currentPhase = phaseMap[currentEvent];

  const steps: { content: string; completedAt: number }[] = [
    { content: 'Analyze issue requirements', completedAt: 2 },
    { content: 'Design implementation approach', completedAt: 2 },
    { content: 'Implement solution', completedAt: 4 },
    { content: 'Run tests and CI', completedAt: 4 },
    { content: 'Create pull request', completedAt: 5 },
  ];

  // Error/timeout cancels remaining steps
  if (currentPhase === -1) {
    return steps.map((step, index) => ({
      content: step.content,
      status: index < 2 ? 'completed' as const : 'canceled' as const,
    }));
  }

  return steps.map((step) => {
    if (currentPhase >= step.completedAt) {
      return { content: step.content, status: 'completed' as const };
    }
    if (currentPhase >= step.completedAt - 1) {
      return { content: step.content, status: 'in-progress' as const };
    }
    return { content: step.content, status: 'pending' as const };
  });
}

export interface LinearActivityReporterDeps {
  linearAgentApiClient: LinearAgentApiClient;
  logger: Logger;
}

export interface LinearActivityReporter {
  /**
   * Report a task event to Linear.
   * No-op if sessionId is undefined (graceful skip).
   * Never throws - failures are logged and swallowed.
   */
  reportEvent(event: TaskEvent): Promise<void>;
}

/**
 * Create a Linear Activity Reporter.
 */
export function createLinearActivityReporter(
  deps: LinearActivityReporterDeps
): LinearActivityReporter {
  const { linearAgentApiClient, logger } = deps;

  return {
    async reportEvent(event: TaskEvent): Promise<void> {
      // Graceful skip: tasks without sessionId don't report
      if (event.sessionId === undefined) {
        return;
      }

      const sessionId = event.sessionId;

      try {
        // Step 1: Emit activity
        const activity = mapTaskEventToActivity(event);
        const activityResult = await linearAgentApiClient.emitActivity({
          sessionId,
          type: activity.type,
          body: activity.body,
        });

        if (!activityResult.ok) {
          logger.warn(
            { sessionId, eventType: event.type, error: activityResult.error },
            'Failed to emit Linear activity (non-fatal)'
          );
        }

        // Step 2: Update plan
        const planSteps = buildPlanSteps(event.type);
        const planResult = await linearAgentApiClient.updateSessionPlan({
          sessionId,
          plan: planSteps,
        });

        if (!planResult.ok) {
          logger.warn(
            { sessionId, eventType: event.type, error: planResult.error },
            'Failed to update Linear session plan (non-fatal)'
          );
        }

        // Step 3: Add external URL for PRs
        if (event.type === 'pr_created' && event.prUrl !== undefined) {
          const urlResult = await linearAgentApiClient.updateSessionExternalUrls({
            sessionId,
            externalUrls: [{ label: 'Pull Request', url: event.prUrl }],
          });

          if (!urlResult.ok) {
            logger.warn(
              { sessionId, prUrl: event.prUrl, error: urlResult.error },
              'Failed to update Linear session external URLs (non-fatal)'
            );
          }
        }
      } catch (error) {
        // Fire-and-forget: never fail the task
        logger.error(
          { sessionId, eventType: event.type, error },
          'Unexpected error in Linear activity reporting (non-fatal)'
        );
      }
    },
  };
}
