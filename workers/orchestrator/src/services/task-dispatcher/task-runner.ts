import type { Task } from '../../types/task.js';
import type { WorkerConfig, WorkerHandle } from '../isolation/types.js';
import { WORKER_TYPES } from '../isolation/types.js';
import { systemPrompt } from '../system-prompt.js';
import { stripDockerHeaders } from '../log-formatter.js';
import { getRuntime, type RuntimeEvent, type WorkerRuntime } from '../runtime/index.js';
import { withTimeout } from '../../with-timeout.js';
import {
  resolveTaskRuntime as resolveTaskRuntimeFn,
  getRuntimeDisplayName as getRuntimeDisplayNameFn,
} from './lifecycle.js';
import { buildActiveGoalSection as buildActiveGoalSectionFn } from './prompts.js';
import { getTaskEventUrl as getTaskEventUrlFn } from './prompts.js';
import {
  IMAGE_PULL_TIMEOUT_MS,
  CONTAINER_CREATE_TIMEOUT_MS,
  ZOMBIE_CLEANUP_TIMEOUT_MS,
} from './retry-logic.js';
import type { DispatcherContext } from './dispatcher-context.js';

/**
 * INT-1551 §E.2: per-attempt execution. Owns the worker-startup pipeline
 * (`startWorkerAttempt`) and the runtime-event reducer
 * (`handleRuntimeEvents`) that translates `RuntimeEvent[]` into shared-state
 * mutations.
 */
export class TaskRunner {
  constructor(private readonly ctx: DispatcherContext) {}

  resolveTaskRuntime(task: Task): WorkerRuntime {
    return resolveTaskRuntimeFn(task);
  }

  getRuntimeDisplayName(task: Task): string {
    return getRuntimeDisplayNameFn(task);
  }

  async startWorkerAttempt(
    task: Task,
    params: {
      prompt: string;
      continueSession: boolean;
      injectActiveGoal?: boolean;
    }
  ): Promise<{ ok: true; containerId: string } | { ok: false; error: unknown }> {
    const ctx = this.ctx;
    // INT-1551 §E.7: bail out fast on shutdown so graceful drain doesn't
    // race against a brand-new container creation.
    if (ctx.shutdownSignal?.aborted === true) {
      return { ok: false, error: new Error('Worker startup aborted by shutdown signal') };
    }
    ctx.attemptCompletionSignals.delete(task.taskId);
    ctx.appendOrchestratorTaskLog(
      task.taskId,
      `Starting worker attempt: continueSession=${String(params.continueSession)}`
    );
    const runtimeName = this.resolveTaskRuntime(task);
    const workerTypeConfig = WORKER_TYPES[task.workerType];
    const runtime = getRuntime(runtimeName);
    const runtimeAttemptState = runtime.createAttemptState(task.taskId, ctx.logger);
    if (params.continueSession && task.runtimeSessionId === undefined) {
      return {
        ok: false,
        error: new Error(`${runtimeName} resume requires a persisted runtime session ID`),
      };
    }
    ctx.appendOrchestratorTaskLog(
      task.taskId,
      `Worker config: type=${task.workerType} runtime=${runtimeName} model=${workerTypeConfig.model ?? 'default'} apiUrl=${workerTypeConfig.apiBaseUrl}`
    );
    ctx.appendOrchestratorTaskLog(
      task.taskId,
      `Container config: worktree=${task.worktreePath} baseBranch=${task.baseBranch}`
    );
    if (params.continueSession) {
      ctx.appendOrchestratorTaskLog(
        task.taskId,
        `Exec command: /entrypoint.sh run-attempt (reusing existing container)`
      );
    } else {
      const imageInfo = ctx.isolation.provider.getImageInfo?.();
      ctx.appendOrchestratorTaskLog(
        task.taskId,
        `Creating new container: image=${imageInfo?.configuredRef ?? 'configured'} cmd=/entrypoint.sh`
      );
    }

    const workerConfig: WorkerConfig = {
      taskId: task.taskId,
      worktreePath: task.worktreePath,
      prompt: params.prompt,
      /* v8 ignore start -- ts-type: exactOptionalPropertyTypes spread for systemPrompt linear-issue + worker-model fields in workerConfig @preserve */
      systemPrompt:
        systemPrompt.build({
          taskId: task.taskId,
          ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
          ...(task.linearIssueTitle !== undefined && { linearIssueTitle: task.linearIssueTitle }),
          taskUrl: `https://intexuraos.cloud/#/code-tasks/${task.taskId}`,
          linearIssueLabels: task.linearIssueLabels,
          workerType: task.workerType,
          ...(WORKER_TYPES[task.workerType].model !== undefined && {
            modelName: WORKER_TYPES[task.workerType].model,
          }),
          ...(task.agentType !== undefined && { agentType: task.agentType }),
          ...(task.trackingCommentId !== undefined && {
            trackingCommentId: task.trackingCommentId,
          }),
          ...(task.continuationPrNumber !== undefined && {
            continuationPrNumber: task.continuationPrNumber,
          }),
          ...(task.continuationPrBranch !== undefined && {
            continuationPrBranch: task.continuationPrBranch,
          }),
          ...(task.executionMemoryContext !== undefined && {
            executionMemoryContext: task.executionMemoryContext,
          }),
          ...(task.reviewTypes !== undefined && { reviewTypes: task.reviewTypes }),
        }) +
        /* v8 ignore stop @preserve */
        (params.injectActiveGoal === true ? buildActiveGoalSectionFn(task, params.prompt) : ''),
      workerType: task.workerType,
      runtimeOverride: runtimeName,
      ...(task.runtimeSessionId !== undefined && { runtimeSessionId: task.runtimeSessionId }),
      secrets: ctx.isolation.getSecrets(),
      gcpSaKeyPath: ctx.isolation.gcpSaKeyPath,
      githubAppKeyPath: ctx.isolation.githubAppKeyPath,
      continueSession: params.continueSession,
      onLog: (chunk) => {
        const cleaned = stripDockerHeaders(chunk);
        ctx.lastOutputAt.set(task.taskId, Date.now());
        ctx.activityTimeoutManager.touch(task.taskId);
        void this.handleRuntimeEvents(task, runtime.processLogChunk(runtimeAttemptState, cleaned));
      },
      onComplete: (exitCode) => {
        void this.handleRuntimeEvents(task, runtime.flushAttemptState(runtimeAttemptState));
        ctx.taskExitCodes.set(task.taskId, exitCode);
        ctx.attemptCompletionSignals.add(task.taskId);
        ctx.activityTimeoutManager.stop(task.taskId);
        ctx.appendOrchestratorTaskLog(
          task.taskId,
          `Worker attempt completed: exitCode=${String(exitCode)}`
        );
        ctx.logForwarder.flushAndStop(task.taskId).catch((error: unknown) => {
          ctx.logger.error({ taskId: task.taskId, error }, 'Failed to flush logs on completion');
        });
      },
    };

    ctx.logger.info(
      {
        taskId: task.taskId,
        agentType: task.agentType ?? 'default',
        systemPromptLength: workerConfig.systemPrompt.length,
        userPromptLength: params.prompt.length,
      },
      'System prompt built'
    );

    ctx.claudeErrors.delete(task.taskId);
    ctx.taskExitCodes.delete(task.taskId);
    ctx.lastOutputAt.set(task.taskId, Date.now());
    // INT-1455: record attempt start time so the classifier can compute
    // duration on completion. No matching delete() here — the immediate
    // set() below replaces any stale value from a prior attempt.
    ctx.attemptStartedAt.set(task.taskId, Date.now());

    // Store promise to enable zombie cleanup if timeout fires mid-creation.
    let createPromise: Promise<WorkerHandle> | undefined;

    try {
      await ctx.isolation.tokenRefresher.registerTask(task.taskId);

      // INT-1551 §E.7: thread the shutdown signal into the long awaits so a
      // SIGTERM during pull/create short-circuits the race instead of leaving
      // `main.ts` to time out the whole drain. The underlying provider call
      // itself is not abortable, so the zombie-cleanup block at the bottom of
      // the catch handler still owns the late-resolution path.
      const shutdownSignal = ctx.shutdownSignal;

      // Phase 1/2: Pull worker image (network-bound, variable latency)
      // Only pull for new containers — continued sessions reuse existing containers.
      if (!params.continueSession && ctx.isolation.provider.pullImage !== undefined) {
        ctx.appendOrchestratorTaskLog(task.taskId, 'Phase 1/2: Pulling worker image...');
        const resolvedImage = await withTimeout(
          ctx.isolation.provider.pullImage(task.taskId, (message) => {
            ctx.appendOrchestratorTaskLog(task.taskId, message);
          }),
          IMAGE_PULL_TIMEOUT_MS,
          `Image pull timed out after ${String(IMAGE_PULL_TIMEOUT_MS / 1000)}s`,
          shutdownSignal
        );
        workerConfig.resolvedImage = resolvedImage;
      }

      // Phase 2/2: Create worker container (deterministic, ~40s)
      if (!params.continueSession) {
        ctx.appendOrchestratorTaskLog(task.taskId, 'Phase 2/2: Creating worker container...');
      }
      createPromise = ctx.isolation.provider.createWorker(workerConfig);

      const handle = await withTimeout(
        createPromise,
        CONTAINER_CREATE_TIMEOUT_MS,
        `Container creation timed out after ${String(CONTAINER_CREATE_TIMEOUT_MS / 1000)}s — Docker may be unresponsive`,
        shutdownSignal
      );

      ctx.appendOrchestratorTaskLog(
        task.taskId,
        `Worker container ready: containerId=${handle.containerId}`
      );

      // Best-effort: send task_started event to code-agent
      ctx.webhookClient
        .send({
          url: getTaskEventUrlFn(task.webhookUrl),
          secret: task.webhookSecret,
          payload: {
            taskId: task.taskId,
            event: 'task_started',
            attempt: task.attemptCount ?? 1,
            workerType: task.workerType,
          },
          taskId: task.taskId,
        })
        .catch((sendError: unknown) => {
          ctx.logger.warn(
            { taskId: task.taskId, error: sendError },
            'Failed to send task_started event (best-effort)'
          );
        });

      ctx.activityTimeoutManager.start(task.taskId);
      return { ok: true, containerId: handle.containerId };
    } catch (error) {
      // If the timeout fired but createWorker is still in-flight, it may
      // eventually succeed and leave a zombie container running with no
      // monitoring. Attach a cleanup handler to destroy it if that happens.
      createPromise
        ?.then((handle) => {
          ctx.logger.warn(
            { taskId: task.taskId, containerId: handle.containerId },
            'Late container created after timeout — destroying zombie'
          );
          ctx.appendOrchestratorTaskLog(
            task.taskId,
            `Destroying zombie container created after timeout: ${handle.containerId}`
          );
          return withTimeout(
            ctx.isolation.provider.destroyWorker(task.taskId),
            ZOMBIE_CLEANUP_TIMEOUT_MS,
            'Zombie container cleanup timed out'
          );
        })
        .catch(() => {
          // createWorker itself failed or cleanup timed out — best effort
        });

      /* v8 ignore start -- ts-type: error instanceof Error ternary creates branch; FakeIsolationProvider throws Error instances so String(error) branch is unreachable in unit tests @preserve */
      ctx.appendOrchestratorTaskLog(
        task.taskId,
        `Worker start failed: ${error instanceof Error ? error.message : String(error)}`
      );
      /* v8 ignore stop @preserve */
      return { ok: false, error };
    }
  }

  async handleRuntimeEvents(task: Task, events: RuntimeEvent[]): Promise<void> {
    const ctx = this.ctx;
    let shouldPersistTask = false;
    const taskId = task.taskId;
    const runtimeName = this.resolveTaskRuntime(task);

    for (const event of events) {
      if (event.type === 'log') {
        if (event.text !== '') {
          if (runtimeName === 'codex') {
            ctx.logForwarder.appendRawChunk(taskId, event.text);
          } else {
            ctx.logForwarder.appendChunk(taskId, event.text);
          }
        }
        continue;
      }

      if (event.type === 'runtime_session_started') {
        if (task.runtimeSessionId !== event.sessionId) {
          task.runtimeSessionId = event.sessionId;
          shouldPersistTask = true;
        }
        ctx.logger.info({ taskId, sessionId: event.sessionId }, 'Detected runtime session start');
        continue;
      }

      if (event.type === 'attempt_completed') {
        if (!ctx.attemptCompletionSignals.has(taskId)) {
          ctx.taskExitCodes.set(taskId, event.exitCode);
          ctx.attemptCompletionSignals.add(taskId);
          ctx.activityTimeoutManager.stop(taskId);
          ctx.logger.info(
            { taskId, exitCode: event.exitCode },
            'Detected runtime stream result; signaling attempt completion'
          );
        }
        continue;
      }

      if (!ctx.attemptCompletionSignals.has(taskId)) {
        ctx.taskExitCodes.set(taskId, event.exitCode);
        ctx.attemptCompletionSignals.add(taskId);
        ctx.activityTimeoutManager.stop(taskId);
        ctx.logger.info(
          { taskId, exitCode: event.exitCode },
          'Detected runtime stream result; signaling attempt completion'
        );
      }
      ctx.claudeErrors.set(taskId, event.errorMessage);
    }

    if (shouldPersistTask) {
      await ctx.saveTask(task);
    }
  }
}
