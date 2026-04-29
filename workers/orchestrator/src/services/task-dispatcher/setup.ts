import type { Logger } from '@intexuraos/common-core';
import type { OrchestratorConfig } from '../../types/config.js';
import type { Task, TaskError, TaskResult } from '../../types/task.js';
import type { CreateTaskRequest } from '../../types/api.js';
import type { StatePersistence } from '../state-persistence.js';
import type { WorktreeManager } from '../worktree-manager.js';
import type { LogForwarder } from '../log-forwarder.js';
import type { WebhookClient } from '../webhook-client.js';
import type { StatusUpdateClient } from '../status-update-client.js';
import type { ActivityTimeoutManager } from '../activity-timeout-manager.js';
import type { TurnMetricsCollector } from '../turn-metrics-collector.js';
import type { AgentComplianceValidator } from '../agent-compliance-validator.js';
import type { MetricsClient } from '../../metrics.js';
import type { Mutex } from 'async-mutex';
import type { IsolationConfig } from '../task-dispatcher.js';
import type { VerifierOverrideForTests } from './completion-pipeline.js';
import type { DispatcherContext } from './dispatcher-context.js';
import { buildResumePreamble as buildResumePreambleFn } from './prompts.js';

/**
 * INT-1551 §E.6: assemble the `DispatcherContext` shared with sub-modules.
 *
 * The dispatcher class still owns the per-task state Maps/Sets and counter
 * physically; we hand the references in via `state` so the context can mutate
 * them in-place. The cross-module callbacks are passed as `bridges` and wired
 * verbatim — no behavioral change vs. inlining inside the constructor.
 */
export interface DispatcherContextBridges {
  appendOrchestratorTaskLog: (taskId: string, message: string) => void;
  appendTaggedTaskLog: (taskId: string, tag: string, message: string) => void;
  flushTaskLogs: (taskId: string) => Promise<void>;
  handleTaskCompletion: (task: Task) => Promise<void>;
  checkForResult: (task: Task) => Promise<TaskResult | undefined>;
  saveTask: (task: Task) => Promise<void>;
  getTask: (taskId: string) => Promise<Task | null>;
  startWorkerAttempt: (
    task: Task,
    params: { prompt: string; continueSession: boolean; injectActiveGoal?: boolean }
  ) => Promise<{ ok: true; containerId: string } | { ok: false; error: unknown }>;
  finalizeTask: (
    task: Task,
    statusParam: 'completed' | 'failed' | 'interrupted' | 'cancelled',
    payload: { result?: TaskResult; error?: TaskError; resumedCompletion?: boolean },
    keepLogForwarderOpen?: boolean
  ) => Promise<void>;
  teardownAttempt: (taskId: string, keepSession: boolean) => Promise<void>;
  clearTaskTimers: (taskId: string) => void;
  scheduleTimeoutWarning: (taskId: string) => void;
  scheduleTimeoutKill: (taskId: string) => void;
  startCompletionMonitoring: (taskId: string) => void;
  failAcceptedResume: (task: Task, error: unknown) => Promise<void>;
  getRuntimeDisplayName: (task: Task) => string;
  getDefaultRepository: (request: CreateTaskRequest) => string;
}

export interface DispatcherContextState {
  readonly activeTasks: Map<string, NodeJS.Timeout>;
  readonly claudeErrors: Map<string, string>;
  readonly taskExitCodes: Map<string, number>;
  readonly attemptStartedAt: Map<string, number>;
  readonly attemptCompletionSignals: Set<string>;
  readonly completionInProgress: Set<string>;
  readonly inactivityRestartInProgress: Set<string>;
  readonly pendingMessages: Map<string, string[]>;
  readonly lastOutputAt: Map<string, number>;
  /** INT-1551 §E.7: tracks fire-and-forget handler promises for graceful shutdown. */
  readonly inFlightHandlers: Set<Promise<unknown>>;
  readonly capacityMutex: Mutex;
  /** Mutable reference to the dispatcher's running-count counter. */
  readonly runningCount: { value: number };
}

export interface DispatcherContextDeps {
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
  readonly verifyOverride: VerifierOverrideForTests['verify'] | undefined; // @allow-undefined-type -- mirrors the source field on TaskDispatcher; using `?:` would change the type identity used by sub-modules
  readonly preserveWorkerContainers: boolean;
}

export function buildDispatcherContext(
  deps: DispatcherContextDeps,
  state: DispatcherContextState,
  bridges: DispatcherContextBridges
): DispatcherContext {
  return {
    logger: deps.logger,
    config: deps.config,
    isolation: deps.isolation,
    logForwarder: deps.logForwarder,
    webhookClient: deps.webhookClient,
    statusUpdateClient: deps.statusUpdateClient,
    statePersistence: deps.statePersistence,
    worktreeManager: deps.worktreeManager,
    metrics: deps.metrics,
    activityTimeoutManager: deps.activityTimeoutManager,
    turnMetricsCollector: deps.turnMetricsCollector,
    agentComplianceValidator: deps.agentComplianceValidator,
    completionMaxAttempts: deps.completionMaxAttempts,
    extractResumeSummaryFn: deps.extractResumeSummaryFn,
    verifyOverride: deps.verifyOverride,
    preserveWorkerContainers: deps.preserveWorkerContainers,
    activeTasks: state.activeTasks,
    claudeErrors: state.claudeErrors,
    taskExitCodes: state.taskExitCodes,
    attemptStartedAt: state.attemptStartedAt,
    attemptCompletionSignals: state.attemptCompletionSignals,
    completionInProgress: state.completionInProgress,
    inactivityRestartInProgress: state.inactivityRestartInProgress,
    pendingMessages: state.pendingMessages,
    lastOutputAt: state.lastOutputAt,
    inFlightHandlers: state.inFlightHandlers,
    shutdownSignal: undefined,
    trackInFlight: <T>(promise: Promise<T>): Promise<T> => {
      state.inFlightHandlers.add(promise);
      promise
        .catch(() => {
          // Errors are owned by the originating call site — we only track
          // settlement here so shutdown can await drain.
        })
        .finally(() => {
          state.inFlightHandlers.delete(promise);
        });
      return promise;
    },
    releaseSlot: (): void => {
      if (state.runningCount.value > 0) state.runningCount.value--;
    },
    appendOrchestratorTaskLog: bridges.appendOrchestratorTaskLog,
    appendTaggedTaskLog: bridges.appendTaggedTaskLog,
    flushTaskLogs: bridges.flushTaskLogs,
    handleTaskCompletion: bridges.handleTaskCompletion,
    checkForResult: bridges.checkForResult,
    saveTask: bridges.saveTask,
    getTask: bridges.getTask,
    startWorkerAttempt: bridges.startWorkerAttempt,
    finalizeTask: bridges.finalizeTask,
    teardownAttempt: bridges.teardownAttempt,
    clearTaskTimers: bridges.clearTaskTimers,
    scheduleTimeoutWarning: bridges.scheduleTimeoutWarning,
    scheduleTimeoutKill: bridges.scheduleTimeoutKill,
    startCompletionMonitoring: bridges.startCompletionMonitoring,
    failAcceptedResume: bridges.failAcceptedResume,
    getRuntimeDisplayName: bridges.getRuntimeDisplayName,
    incrementRunningCount: (): void => {
      state.runningCount.value++;
    },
    tryAcquireCapacitySlot: async (): Promise<
      | { ok: true; value: undefined }
      | { ok: false; error: { type: 'at_capacity'; message: string } }
    > => {
      return await state.capacityMutex.runExclusive(() => {
        if (state.runningCount.value >= deps.config.capacity) {
          return {
            ok: false as const,
            error: { type: 'at_capacity' as const, message: 'Service at capacity' },
          };
        }
        state.runningCount.value++;
        return { ok: true as const, value: undefined };
      });
    },
    getDefaultRepository: bridges.getDefaultRepository,
    buildResumePreamble: (task?: Task): string => buildResumePreambleFn(task),
  };
}
