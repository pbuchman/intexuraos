import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface TmuxManagerConfig {
  logBasePath: string;
  claudePath?: string;
}

export interface TmuxError {
  code: string;
  message: string;
}

export interface SessionParams {
  taskId: string;
  worktreePath: string;
  linearIssueId?: string;
  prompt: string;
  workerType: 'opus' | 'auto' | 'glm';
  machine: 'mac' | 'vm';
}

export class TmuxManager {
  constructor(private readonly config: TmuxManagerConfig) {}

  async startSession(params: SessionParams): Promise<void> {
    const { taskId, worktreePath, linearIssueId, prompt, machine } = params;

    // Ensure log directory exists
    const logFilePath = this.getLogFilePath(taskId);
    await mkdir(dirname(logFilePath), { recursive: true });

    // Build system prompt
    const systemPromptParams = {
      taskId,
      worktreePath,
      prompt,
      machine,
      ...(linearIssueId !== undefined && { linearIssueId }),
    };
    const systemPrompt = this.buildSystemPrompt(systemPromptParams);

    // Escape prompt for shell
    const escapedPrompt = this.escapeForShell(systemPrompt);

    // Build claude command
    const claudePath = this.config.claudePath ?? 'claude';
    const claudeCommand = `${claudePath} --system-prompt '${escapedPrompt}' --print`;

    // Build tmux command
    const sessionName = `cc-task-${taskId}`;
    const tmuxCommand = `tmux new-session -d -s ${sessionName} "cd '${worktreePath}' && ${claudeCommand} 2>&1 | tee '${logFilePath}'"`;

    try {
      await execAsync(tmuxCommand);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to start tmux session: ${message}`);
    }
  }

  async killSession(taskId: string, graceful = true): Promise<void> {
    const sessionName = `cc-task-${taskId}`;

    try {
      if (graceful) {
        // Send Ctrl-C for graceful shutdown
        try {
          await execAsync(`tmux send-keys -t ${sessionName} C-c`);
        } catch {
          // Session might not exist, continue to kill
        }

        // Wait 10 seconds
        await new Promise((resolve) => setTimeout(resolve, 10000));

        // Check if still running
        if (await this.isSessionRunning(taskId)) {
          await execAsync(`tmux kill-session -t ${sessionName}`);
        }
      } else {
        // Force kill immediately
        await execAsync(`tmux kill-session -t ${sessionName}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to kill tmux session: ${message}`);
    }
  }

  async isSessionRunning(taskId: string): Promise<boolean> {
    const sessionName = `cc-task-${taskId}`;

    try {
      await execAsync(`tmux has-session -t ${sessionName}`);
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}"');

      const sessions = stdout
        .split('\n')
        .filter((line) => line.length > 0)
        .filter((name) => name.startsWith('cc-task-'))
        .map((name) => name.replace('cc-task-', ''));

      return sessions;
    } catch {
      return [];
    }
  }

  getLogFilePath(taskId: string): string {
    return `${this.config.logBasePath}/${taskId}.log`;
  }

  private buildSystemPrompt(params: {
    taskId: string;
    worktreePath: string;
    linearIssueId?: string;
    prompt: string;
    machine: 'mac' | 'vm';
  }): string {
    const { taskId, worktreePath, linearIssueId, prompt, machine } = params;

    // Sanitize user prompt
    const sanitizedPrompt = this.sanitizePrompt(prompt);

    // Build system prompt
    const systemPrompt = `[SYSTEM CONTEXT]
You are a Claude Code worker in IntexuraOS.
Task ID: ${taskId}
Worktree: ${worktreePath}
Machine: ${machine}
${linearIssueId !== undefined ? `Linear Issue: INT-${linearIssueId}` : ''}

[MANDATORY - FIRST ACTION]${
      linearIssueId !== undefined
        ? `
You MUST invoke: /linear INT-${linearIssueId}
DO NOT proceed with any other action until this completes.`
        : ''
    }
[GIT WORKFLOW]
- Create feature branch from origin/development
- Commit with format: "INT-{issue-id} Description"
- Push to origin
- Update Linear issue state to In Review

[REQUIREMENTS]
- Follow CLAUDE.md instructions in worktree
- Use Test-First Development (write tests BEFORE implementation)
- Run pnpm run ci:tracked before committing
- Never push without CI passing

[TASK]
${sanitizedPrompt}`;

    // Truncate to 4000 characters
    return systemPrompt.slice(0, 4000);
  }

  private sanitizePrompt(prompt: string): string {
    // Remove XML tags that could be injected
    let sanitized = prompt.replace(/<[^>]*>/g, '');

    // Remove system instruction keywords
    const forbiddenKeywords = [
      'ignore',
      'disregard',
      'forget',
      'override',
      'system',
      'instruction',
      'instead',
      'rather',
      'but',
      'however',
    ];
    for (const keyword of forbiddenKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      sanitized = sanitized.replace(regex, '');
    }

    // Remove extra whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();

    return sanitized;
  }

  private escapeForShell(str: string): string {
    // Escape single quotes and backslashes for shell
    return str.replace(/'/g, "'\\''").replace(/\\/g, '\\\\');
  }
}
