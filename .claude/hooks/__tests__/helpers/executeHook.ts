import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Hooks are in the parent directory of __tests__
const HOOKS_DIR = path.resolve(__dirname, '..', '..');

/**
 * Result of executing a hook
 */
export interface HookExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  logFile?: string;
  logEntries?: LogEntry[];
}

/**
 * Parsed log entry from hooks.log
 */
export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARNED' | 'BLOCKED';
  hook: string;
  pattern: string;
  file: string;
  message: string;
  suggestion: string;
}

/**
 * Options for executing a hook
 */
export interface ExecuteHookOptions {
  hookName: string;
  input: Record<string, unknown>;
  cwd?: string;
  env?: Record<string, string>;
  transcriptContent?: string; // For hooks that read transcripts
}

/**
 * Parses a hooks.log file into structured entries
 */
function parseHooksLog(logContent: string): LogEntry[] {
  const lines = logContent.trim().split('\n');
  const entries: LogEntry[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const parts = line.split('\t');
    if (parts.length >= 7) {
      entries.push({
        timestamp: parts[0],
        level: parts[1] as 'INFO' | 'WARNED' | 'BLOCKED',
        hook: parts[2],
        pattern: parts[3],
        file: parts[4],
        message: parts[5],
        suggestion: parts[6],
      });
    }
  }

  return entries;
}

/**
 * Executes a hook script with mocked JSON input via stdin
 * Captures exit code, stdout, stderr, and log file contents
 * Uses isolated log files to prevent race conditions in parallel tests
 */
export function executeHook(options: ExecuteHookOptions): HookExecutionResult {
  const { hookName, input, cwd, env, transcriptContent } = options;

  // Resolve hook script path (hooks are in HOOKS_DIR)
  const hookPath = path.join(HOOKS_DIR, `${hookName}.sh`);

  if (!fs.existsSync(hookPath)) {
    throw new Error(`Hook script not found: ${hookPath}`);
  }

  // Prepare the input JSON
  const inputJson = JSON.stringify(input);

  // Determine working directory (default to hooks dir)
  const workingDir = cwd ?? HOOKS_DIR;

  // Use isolated log file per test invocation to prevent race conditions
  const tempDir = path.join(HOOKS_DIR, '__tests__', 'fixtures', 'temp-files');
  fs.mkdirSync(tempDir, { recursive: true });
  const isolatedLogFile = path.join(tempDir, `hooks-${randomUUID()}.log`);

  // Prepare environment
  const processEnv: Record<string, string> = {
    ...process.env,
    // Clear CI-related env vars that might affect hook behavior
    CI: '',
    CONTINUOUS_INTEGRATION: '',
    CLAUDE_HOOKS_LOG_FILE: isolatedLogFile,
    ...env,
  };

  // If transcript content is provided, write it to a temp file
  let transcriptPath: string | undefined;
  let finalInputJson = inputJson;
  if (transcriptContent) {
    transcriptPath = path.join(tempDir, `transcript-${randomUUID()}.jsonl`);
    fs.writeFileSync(transcriptPath, transcriptContent, 'utf-8');
    // Update input to include transcript path
    finalInputJson = JSON.stringify({ ...input, transcript_path: transcriptPath });
  }

  // Spawn the hook script
  const child = spawn('bash', [hookPath], {
    cwd: workingDir,
    env: processEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  // Write input to stdin
  child.stdin?.write(finalInputJson);
  child.stdin?.end();

  // Wait for completion
  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      // Clean up temp transcript file if created
      if (transcriptPath && fs.existsSync(transcriptPath)) {
        try {
          fs.unlinkSync(transcriptPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      // Read the isolated log file if it exists
      let logFile: string | undefined;
      let logEntries: LogEntry[] | undefined;

      if (fs.existsSync(isolatedLogFile)) {
        try {
          logFile = fs.readFileSync(isolatedLogFile, 'utf-8');
          logEntries = parseHooksLog(logFile);
          // Clean up the isolated log file
          fs.unlinkSync(isolatedLogFile);
        } catch {
          // Log file might be locked or malformed
        }
      }

      resolve({
        exitCode: code,
        stdout,
        stderr,
        logFile,
        logEntries,
      });
    });

    child.on('error', (error) => {
      // Clean up temp transcript file if created
      if (transcriptPath && fs.existsSync(transcriptPath)) {
        try {
          fs.unlinkSync(transcriptPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      // Clean up isolated log file
      if (fs.existsSync(isolatedLogFile)) {
        try {
          fs.unlinkSync(isolatedLogFile);
        } catch {
          // Ignore cleanup errors
        }
      }
      reject(error);
    });
  }) as Promise<HookExecutionResult>;
}

/**
 * Synchronous version of executeHook for simple cases
 * Uses spawnSync internally
 * Uses isolated log files to prevent race conditions in parallel tests
 */
export function executeHookSync(options: ExecuteHookOptions): HookExecutionResult {
  const { spawnSync } = require('node:child_process');
  const { hookName, input, cwd, env } = options;

  const hookPath = path.join(HOOKS_DIR, `${hookName}.sh`);

  if (!fs.existsSync(hookPath)) {
    throw new Error(`Hook script not found: ${hookPath}`);
  }

  const inputJson = JSON.stringify(input);
  const workingDir = cwd ?? HOOKS_DIR;

  // Use isolated log file per test invocation to prevent race conditions
  const isolatedLogFile = path.join(
    HOOKS_DIR,
    '__tests__',
    'fixtures',
    'temp-files',
    `hooks-${randomUUID()}.log`
  );
  // Ensure temp directory exists
  fs.mkdirSync(path.dirname(isolatedLogFile), { recursive: true });

  const processEnv: Record<string, string> = {
    ...process.env,
    CI: '',
    CONTINUOUS_INTEGRATION: '',
    CLAUDE_HOOKS_LOG_FILE: isolatedLogFile,
    ...env,
  };

  const result = spawnSync('bash', [hookPath], {
    cwd: workingDir,
    env: processEnv,
    input: inputJson,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  // Read the isolated log file if it exists
  let logFile: string | undefined;
  let logEntries: LogEntry[] | undefined;

  if (fs.existsSync(isolatedLogFile)) {
    try {
      logFile = fs.readFileSync(isolatedLogFile, 'utf-8');
      logEntries = parseHooksLog(logFile);
      // Clean up the isolated log file
      fs.unlinkSync(isolatedLogFile);
    } catch {
      // Log file might be locked or malformed
    }
  }

  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    logFile,
    logEntries,
  };
}

/**
 * Synchronous version of executeHook with custom temp directory override
 * Use this to isolate tests that use timing files from each other
 */
export function executeHookSyncWithTempDir(
  options: ExecuteHookOptions,
  tempDir: string
): HookExecutionResult {
  return executeHookSync({
    ...options,
    env: {
      ...options.env,
      CLAUDE_CMD_TIMING_DIR: tempDir,
    },
  });
}

/**
 * Clears test artifacts before running tests
 * Note: With isolated log files per test invocation, hooks.log no longer needs clearing
 * This function now only cleans up other shared log files
 */
export function clearHooksLog(): void {
  // Note: hooks.log is now isolated per test invocation via CLAUDE_HOOKS_LOG_FILE
  // No need to clear the shared hooks.log file

  // Note: /tmp/claude-cmd-timing is NOT cleared here to avoid race conditions
  // Individual tests that use timing files handle their own cleanup

  // Clear sessions.log (used by session tracking hooks)
  const sessionsLogPath = path.join(HOOKS_DIR, 'sessions.log');
  if (fs.existsSync(sessionsLogPath)) {
    try {
      fs.unlinkSync(sessionsLogPath);
    } catch {
      // File might be locked by another process
    }
  }

  // Clear commands.log (used by command logging hooks)
  const commandsLogPath = path.join(HOOKS_DIR, 'commands.log');
  if (fs.existsSync(commandsLogPath)) {
    try {
      fs.unlinkSync(commandsLogPath);
    } catch {
      // File might be locked by another process
    }
  }

  // Clear ci-phases.log (used by CI phase tracking hooks)
  const ciPhasesLogPath = path.join(HOOKS_DIR, 'ci-phases.log');
  if (fs.existsSync(ciPhasesLogPath)) {
    try {
      fs.unlinkSync(ciPhasesLogPath);
    } catch {
      // File might be locked by another process
    }
  }
}
