import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Mutex } from 'async-mutex';
import type { Result, Logger } from '@intexuraos/common-core';
import type { OrchestratorConfig } from '../types/config.js';
import type { Task, TaskStatus, TaskResult, TaskError } from '../types/task.js';
import type { CreateTaskRequest } from '../types/api.js';
import type { StatePersistence } from './state-persistence.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { TmuxManager, SessionParams } from './tmux-manager.js';
import type { LogForwarder } from './log-forwarder.js';
import type { WebhookClient } from './webhook-client.js';
import type { GitHubTokenService } from '../github/token-service.js';

const execAsync = promisify(exec);

const TASK_TIMEOUT_WARNING_MS = 115 * 60 * 1000; // 1h 55m
const TASK_TIMEOUT_KILL_MS = 120 * 60 * 1000; // 2h
const CANCELLATION_GRACE_PERIOD_MS = 10 * 1000; // 10s
const COMPLETION_CHECK_INTERVAL_MS = 30 * 1000; // 30s

export interface DispatchError {
  type: 'at_capacity' | 'invalid_request' | 'service_error';
  message: string;
  originalError?: unknown;
}

export interface CancelError {
  type: 'not_found' | 'already_completed' | 'service_error';
  message: string;
  originalError?: unknown;
}

export class TaskDispatcher {
  private runningCount = 0;
  private readonly capacityMutex = new Mutex();
  private readonly activeTasks = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly statePersistence: StatePersistence,
    private readonly worktreeManager: WorktreeManager,
    private readonly tmuxManager: TmuxManager,
    private readonly logForwarder: LogForwarder,
    private readonly webhookClient: WebhookClient,
    private readonly githubTokenService: GitHubTokenService,
    private readonly logger: Logger
  ) {}

  async submitTask(request: CreateTaskRequest): Promise<Result<void, DispatchError>> {
    // Atomic capacity check
    const capacityCheck = await this.capacityMutex.runExclusive(() => {
      if (this.runningCount >= this.config.capacity) {
        return {
          ok: false as const,
          error: { type: 'at_capacity' as const, message: 'Service at capacity' },
        };
      }
      this.runningCount++;
      return { ok: true as const, value: undefined };
    });

    if (!capacityCheck.ok) {
      return capacityCheck;
    }

    const taskId = request.taskId;

    try {
      // Get repository and base branch from GitHub API if not provided
      const repository = request.repository ?? this.getDefaultRepository(request);
      const baseBranch = request.baseBranch ?? 'development';

      // Create worktree
      let worktreePath: string;
      try {
        worktreePath = await this.worktreeManager.createWorktree(taskId, baseBranch);
      } catch (error) {
        this.runningCount--;
        return {
          ok: false,
          error: {
            type: 'service_error',
            message: 'Failed to create worktree',
            originalError: error,
          },
        };
      }

      // Start tmux session
      const sessionParams: SessionParams = {
        taskId,
        worktreePath,
        prompt: request.prompt,
        workerType: request.workerType,
        machine: 'mac', // TODO: determine from config
        linearIssueId: request.linearIssueId,
      };

      try {
        await this.tmuxManager.startSession(sessionParams);
      } catch (error) {
        this.runningCount--;
        void this.worktreeManager.removeWorktree(taskId);
        return {
          ok: false,
          error: {
            type: 'service_error',
            message: 'Failed to start tmux session',
            originalError: error,
          },
        };
      }

      // Start log forwarding
      const logFilePath = this.getLogFilePath(taskId);
      this.logForwarder.startForwarding(taskId, logFilePath);

      // Create task object
      const task: Task = {
        taskId,
        workerType: request.workerType,
        prompt: request.prompt,
        repository,
        baseBranch,
        linearIssueId: request.linearIssueId,
        linearIssueTitle: request.linearIssueTitle,
        slug: request.slug,
        webhookUrl: request.webhookUrl,
        webhookSecret: request.webhookSecret,
        actionId: request.actionId,
        status: 'running',
        tmuxSession: `cc-task-${taskId}`,
        worktreePath,
        startedAt: new Date().toISOString(),
      };

      // Save state
      await this.saveTask(task);

      // Schedule timeout checks
      this.scheduleTimeoutWarning(taskId);
      this.scheduleTimeoutKill(taskId);

      // Start completion monitoring
      this.startCompletionMonitoring(taskId);

      this.logger.info({ taskId, runningCount: this.runningCount }, 'Task started');

      return { ok: true, value: undefined };
    } catch (error) {
      this.runningCount--;
      return {
        ok: false,
        error: { type: 'service_error', message: 'Failed to start task', originalError: error },
      };
    }
  }

  async cancelTask(taskId: string): Promise<Result<void, CancelError>> {
    const state = await this.statePersistence.load();
    const task = state.tasks[taskId];

    if (task === undefined) {
      return { ok: false, error: { type: 'not_found', message: 'Task not found' } };
    }

    if (task.status !== 'running') {
      return { ok: false, error: { type: 'already_completed', message: 'Task already completed' } };
    }

    try {
      // Kill tmux session (graceful)
      await this.tmuxManager.killSession(taskId, true);

      // Wait for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, CANCELLATION_GRACE_PERIOD_MS));

      // Force kill if still running
      const isRunning = await this.tmuxManager.isSessionRunning(taskId);
      if (isRunning) {
        await this.tmuxManager.killSession(taskId, false);
      }

      // Update task status
      task.status = 'cancelled';
      task.completedAt = new Date().toISOString();
      await this.saveTask(task);

      // Stop log forwarding
      await this.logForwarder.stopForwarding(taskId);

      // Decrease running count
      this.runningCount--;
      this.clearTaskTimers(taskId);

      // Send webhook
      await this.webhookClient.send({
        url: task.webhookUrl,
        secret: task.webhookSecret,
        payload: {
          taskId,
          status: 'cancelled',
          duration: new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime(),
        },
        taskId,
      });

      this.logger.info({ taskId }, 'Task cancelled');

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: { type: 'service_error', message: 'Failed to cancel task', originalError: error },
      };
    }
  }

  async getTask(taskId: string): Promise<Task | null> {
    const state = await this.statePersistence.load();
    return state.tasks[taskId] ?? null;
  }

  getRunningCount(): number {
    return this.runningCount;
  }

  getCapacity(): number {
    return this.config.capacity;
  }

  private getDefaultRepository(_request: CreateTaskRequest): string {
    // TODO: Implement GitHub API call to get default repository
    // For now, use a default
    return 'pbuchman/intexuraos';
  }

  private getLogFilePath(taskId: string): string {
    return `${this.config.logBasePath}/${taskId}.log`;
  }

  private async saveTask(task: Task): Promise<void> {
    const state = await this.statePersistence.load();
    state.tasks[task.taskId] = task;
    await this.statePersistence.save(state);
  }

  private scheduleTimeoutWarning(taskId: string): void {
    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        const task = await this.getTask(taskId);
        if (task !== null && task.status === 'running') {
          this.logger.warn({ taskId }, 'Task approaching 2-hour timeout');
        }
      })();
    }, TASK_TIMEOUT_WARNING_MS);

    this.activeTasks.set(`${taskId}-warning`, timeout);
  }

  private scheduleTimeoutKill(taskId: string): void {
    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        const task = await this.getTask(taskId);
        if (task?.status !== 'running') {
          return;
        }

        this.logger.warn({ taskId }, 'Task timeout - killing');

        // Kill tmux session
        await this.tmuxManager.killSession(taskId, false);

        // Stop log forwarding
        await this.logForwarder.stopForwarding(taskId);

        // Check for PR
        const result = await this.checkForResult(task);

        // Update task
        task.status = 'interrupted';
        task.completedAt = new Date().toISOString();
        await this.saveTask(task);

        // Decrease running count
        this.runningCount--;
        this.clearTaskTimers(taskId);

        // Send webhook
        await this.webhookClient.send({
          url: task.webhookUrl,
          secret: task.webhookSecret,
          payload: {
            taskId,
            status: 'interrupted',
            result,
            duration: new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime(),
          },
          taskId,
        });
      })();
    }, TASK_TIMEOUT_KILL_MS);

    this.activeTasks.set(`${taskId}-kill`, timeout);
  }

  private startCompletionMonitoring(taskId: string): void {
    const checkInterval = setInterval(() => {
      void (async (): Promise<void> => {
        const task = await this.getTask(taskId);
        if (task?.status !== 'running') {
          this.clearTaskTimers(taskId);
          return;
        }

        const isRunning = await this.tmuxManager.isSessionRunning(taskId);
        if (!isRunning) {
          // Task completed
          await this.handleTaskCompletion(task);
        }
      })();
    }, COMPLETION_CHECK_INTERVAL_MS);

    this.activeTasks.set(`${taskId}-monitor`, checkInterval);
  }

  private async handleTaskCompletion(task: Task): Promise<void> {
    this.logger.info({ taskId: task.taskId }, 'Task completed naturally');

    // Stop log forwarding
    await this.logForwarder.stopForwarding(task.taskId);

    // Check for PR
    const result = await this.checkForResult(task);

    // Determine final status
    let finalStatus: TaskStatus;
    let error: TaskError | undefined;

    if (result?.prUrl !== undefined) {
      finalStatus = 'completed';
    } else if (result?.ciFailed === true) {
      finalStatus = 'failed';
      error = {
        code: 'CI_FAILED',
        message: 'Task completed but CI failed',
        remediation: { action: 'fix_code', worktreePath: task.worktreePath },
      };
    } else {
      finalStatus = 'failed';
      error = {
        code: 'NO_PR_CREATED',
        message: 'Task completed but no PR was created',
        remediation: { action: 'retry' },
      };
    }

    // Update task
    task.status = finalStatus;
    task.completedAt = new Date().toISOString();
    await this.saveTask(task);

    // Decrease running count
    this.runningCount--;
    this.clearTaskTimers(task.taskId);

    // Send webhook
    await this.webhookClient.send({
      url: task.webhookUrl,
      secret: task.webhookSecret,
      payload: {
        taskId: task.taskId,
        status: finalStatus,
        result,
        error,
        duration: new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime(),
      },
      taskId: task.taskId,
    });
  }

  private async checkForResult(task: Task): Promise<TaskResult | undefined> {
    try {
      // Change to worktree directory
      process.chdir(task.worktreePath);

      // Check for pull requests
      const { stdout: prOutput } = await execAsync(
        'gh pr list --head "*" --json url,number,title,commits --jq .'
      );
      const prs = JSON.parse(prOutput) as {
        url: string;
        headRefName: string;
        commits?: { totalCount: number };
        title: string;
      }[];

      if (prs.length > 0) {
        const pr = prs[0] ?? undefined;
        if (pr === undefined) {
          return undefined;
        }
        const branch = pr.headRefName;
        const commits = pr.commits?.totalCount ?? 0;

        // Check CI status
        const { stdout: ciOutput } = await execAsync(
          `gh pr checks ${branch} --json status --jq .status`
        );
        const ciStatus = JSON.parse(ciOutput) as string;
        const ciFailed = ciStatus === 'FAILURE';

        // Check for rebase result
        let rebaseResult: TaskResult['rebaseResult'];
        try {
          const { stdout: rebaseOutput } = await execAsync(
            'cat .rebase-result.json 2>/dev/null || echo "{}"'
          );
          const parsed = JSON.parse(rebaseOutput) as {
            attempted?: boolean;
            success?: boolean;
            conflictFiles?: string[];
          };
          rebaseResult = parsed.attempted === true ? parsed : undefined;
        } catch {
          // Ignore
        }

        return {
          prUrl: pr.url,
          branch,
          commits,
          summary: pr.title,
          ciFailed,
          rebaseResult,
        };
      }

      return undefined;
    } catch (error) {
      this.logger.error({ taskId: task.taskId, error }, 'Failed to check for task result');
      return undefined;
    }
  }

  private clearTaskTimers(taskId: string): void {
    const keys = [`${taskId}-warning`, `${taskId}-kill`, `${taskId}-monitor`];
    for (const key of keys) {
      const timer = this.activeTasks.get(key);
      if (timer !== undefined) {
        clearTimeout(timer);
        clearInterval(timer);
        this.activeTasks.delete(key);
      }
    }
  }
}
