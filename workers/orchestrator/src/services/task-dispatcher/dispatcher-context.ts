import type { Logger } from '@intexuraos/common-core';
import type { OrchestratorConfig } from '../../types/config.js';
import type { Task, TaskError, TaskResult } from '../../types/task.js';
import type { StatePersistence } from '../state-persistence.js';
import type { WorktreeManager } from '../worktree-manager.js';
import type { LogForwarder } from '../log-forwarder.js';
import type { WebhookClient } from '../webhook-client.js';
import type { StatusUpdateClient } from '../status-update-client.js';
import type { ActivityTimeoutManager } from '../activity-timeout-manager.js';
import type { TurnMetricsCollector } from '../turn-metrics-collector.js';
import type { AgentComplianceValidator } from '../agent-compliance-validator.js';
import type { MetricsClient } from '../../metrics.js';
import type { IsolationConfig } from '../task-dispatcher.js';
import type { VerifierOverrideForTests } from './completion-pipeline.js';

/**
 * INT-1551 §10: shared state and dependency container for the dispatcher
 * sub-modules (`task-runner.ts`, `task-timers.ts`, plus future
 * `attempt-lifecycle.ts` / `completion-pipeline.ts`).
 *
 * The `TaskDispatcher` class still owns all per-task state Maps/Sets
 * physically; this object simply hands those references to the sub-modules
 * so they can mutate them in-place. `TaskDispatcher` builds the context
 * once in its constructor and routes calls through the sub-modules.
 */
export interface DispatcherContext {
  // --- Constructor injectables ---
  readonly logger: Logger;
  readonly config: OrchestratorConfig;
  readonly isolation: IsolationConfig;
  readonly logForwarder: LogForwarder;
  readonly webhookClient: WebhookClient;
  readonly statusUpdateClient: StatusUpdateClient;
  readonly statePersistence: StatePersistence;
  readonly worktreeManager: WorktreeManager;
  readonly metrics: MetricsClient;
  readonly activityTimeoutManager: ActivityTimeoutManager;
  readonly turnMetricsCollector: TurnMetricsCollector | undefined;
  readonly agentComplianceValidator: AgentComplianceValidator | undefined;
  readonly completionMaxAttempts: number;
  readonly extractResumeSummaryFn: (
    taskId: string,
    rawLogs: string
  ) => Promise<string | undefined>;
  readonly verifyOverride: VerifierOverrideForTests['verify'] | undefined;
  readonly preserveWorkerContainers: boolean;

  // --- Per-task state maps/sets (shared, mutable) ---
  readonly activeTasks: Map<string, NodeJS.Timeout>;
  readonly claudeErrors: Map<string, string>;
  readonly taskExitCodes: Map<string, number>;
  readonly attemptStartedAt: Map<string, number>;
  readonly attemptCompletionSignals: Set<string>;
  readonly completionInProgress: Set<string>;
  readonly inactivityRestartInProgress: Set<string>;
  readonly pendingMessages: Map<string, string[]>;
  readonly lastOutputAt: Map<string, number>;

  /**
   * Idempotent slot release helper: decrements the dispatcher's
   * `runningCount` only if positive. Modules use this to decrement instead
   * of inlining the guard. The dispatcher still owns the counter physically.
   */
  releaseSlot: () => void;

  // --- Log helpers (delegators to log-streaming.ts) ---
  appendOrchestratorTaskLog: (taskId: string, message: string) => void;
  appendTaggedTaskLog: (taskId: string, tag: string, message: string) => void;
  flushTaskLogs: (taskId: string) => Promise<void>;

  // --- Cross-module callbacks supplied by the dispatcher ---
  /**
   * Bridges TT.startCompletionMonitoring back to the dispatcher's
   * `handleTaskCompletion` (which lives in CompletionPipeline / the
   * dispatcher class itself for now).
   */
  handleTaskCompletion: (task: Task) => Promise<void>;
  /**
   * Best-effort PR/result extractor used by the timeout-kill flow. Wraps
   * `webhook-callbacks.checkForResult`.
   */
  checkForResult: (task: Task) => Promise<TaskResult | undefined>;
  /**
   * Saves the task back to state persistence. Module functions need it
   * after mutating `task.runtimeSessionId` etc.
   */
  saveTask: (task: Task) => Promise<void>;
  /**
   * Fetches a task by id (read-through state lookup).
   */
  getTask: (taskId: string) => Promise<Task | null>;

  // --- Cross-module orchestration callbacks injected after construction
  // (set on the same context object before sub-modules need them). ---
  /**
   * Starts a worker attempt. Backed by `TaskRunner.startWorkerAttempt`.
   * Wired after the dispatcher constructs its TaskRunner.
   */
  startWorkerAttempt: (
    task: Task,
    params: { prompt: string; continueSession: boolean; injectActiveGoal?: boolean }
  ) => Promise<{ ok: true; containerId: string } | { ok: false; error: unknown }>;
  /**
   * Drives a task to its terminal state, emits webhooks, releases slot.
   * Backed by `CompletionPipeline.finalizeTask`.
   */
  finalizeTask: (
    task: Task,
    statusParam: 'completed' | 'failed' | 'interrupted' | 'cancelled',
    payload: { result?: TaskResult; error?: TaskError; resumedCompletion?: boolean },
    keepLogForwarderOpen?: boolean
  ) => Promise<void>;
  /**
   * Tears down the current worker attempt (destroy/cleanup) optionally
   * keeping the worker session for resume. Backed by
   * `AttemptLifecycle.teardownAttempt`.
   */
  teardownAttempt: (taskId: string, keepSession: boolean) => Promise<void>;
  /**
   * Cancels all per-task timers + clears completion-in-progress flag.
   * Backed by `TaskTimers.clearTaskTimers`.
   */
  clearTaskTimers: (taskId: string) => void;
  /** Best-effort 5h warning timer. */
  scheduleTimeoutWarning: (taskId: string) => void;
  /** Hard 5h kill timer. */
  scheduleTimeoutKill: (taskId: string) => void;
  /** 30s poll on `isWorkerRunning` + `attemptCompletionSignals`. */
  startCompletionMonitoring: (taskId: string) => void;
  /** Convert a resume-startup error → terminal failure. */
  failAcceptedResume: (task: Task, error: unknown) => Promise<void>;
  /** Runtime display-name helper for error messages. */
  getRuntimeDisplayName: (task: Task) => string;
  /** Increment the dispatcher's `runningCount` counter. */
  incrementRunningCount: () => void;
  /**
   * Atomic capacity check. Returns `{ ok: true }` if a slot was reserved
   * (the caller is now responsible for eventually calling `releaseSlot`),
   * or `{ ok: false }` if the dispatcher is at capacity.
   */
  tryAcquireCapacitySlot: () => Promise<
    { ok: true; value: undefined } | { ok: false; error: { type: 'at_capacity'; message: string } }
  >;
  /** Resolves a default repository for a task setup request. */
  getDefaultRepository: (request: import('../../types/api.js').CreateTaskRequest) => string;
  /** Builds the resume preamble used when re-prompting a task. */
  buildResumePreamble: (task?: Task) => string;
}
