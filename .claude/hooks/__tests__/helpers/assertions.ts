import type { HookExecutionResult, LogEntry } from './executeHook.js';

/**
 * Custom assertion helpers for hook test results
 * These provide clearer error messages and reduce boilerplate in tests
 */

/**
 * Asserts that a hook blocked the operation (exit code 2, stderr contains BLOCKED)
 */
export function expectBlocked(
  result: HookExecutionResult,
  options: {
    pattern?: RegExp;
    suggestionIncludes?: string;
    messageIncludes?: string;
  } = {}
): void {
  const { exitCode, stderr } = result;

  // Check exit code
  if (exitCode !== 2) {
    throw new Error(
      `Expected hook to block (exit code 2), but got exit code ${exitCode}.\n` + `stderr: ${stderr}`
    );
  }

  // Check for BLOCKED in stderr
  if (!stderr.includes('BLOCKED')) {
    throw new Error(`Expected 'BLOCKED' in stderr, but got:\n${stderr}`);
  }

  // Check pattern if provided
  if (options.pattern && !options.pattern.test(stderr)) {
    throw new Error(`Expected stderr to match pattern ${options.pattern}, but got:\n${stderr}`);
  }

  // Check suggestion if provided
  if (options.suggestionIncludes && !stderr.includes(options.suggestionIncludes)) {
    throw new Error(
      `Expected stderr to include '${options.suggestionIncludes}', but got:\n${stderr}`
    );
  }

  // Check message if provided
  if (options.messageIncludes && !stderr.includes(options.messageIncludes)) {
    throw new Error(`Expected stderr to include '${options.messageIncludes}', but got:\n${stderr}`);
  }
}

/**
 * Asserts that a hook allowed the operation (exit code 0, empty/clean stderr)
 */
export function expectAllowed(result: HookExecutionResult): void {
  const { exitCode, stderr } = result;

  if (exitCode !== 0) {
    throw new Error(
      `Expected hook to allow (exit code 0), but got exit code ${exitCode}.\n` + `stderr: ${stderr}`
    );
  }

  // Check that stderr doesn't contain BLOCKED or WARNED
  const hasBlockOrWarn = /BLOCKED|WARNED/i.test(stderr);
  if (hasBlockOrWarn) {
    throw new Error(`Expected clean stderr for allowed operation, but got:\n${stderr}`);
  }
}

/**
 * Asserts that a hook warned but didn't block (exit code 0, stderr contains WARNED)
 */
export function expectWarned(
  result: HookExecutionResult,
  options: {
    messageIncludes?: string;
    patternIncludes?: string;
  } = {}
): void {
  const { exitCode, stderr } = result;

  if (exitCode !== 0) {
    throw new Error(
      `Expected hook to warn (exit code 0), but got exit code ${exitCode}.\n` + `stderr: ${stderr}`
    );
  }

  if (!stderr.includes('WARNED') && !stderr.includes('⚠️')) {
    throw new Error(`Expected warning in stderr, but got:\n${stderr}`);
  }

  if (options.messageIncludes && !stderr.includes(options.messageIncludes)) {
    throw new Error(`Expected stderr to include '${options.messageIncludes}', but got:\n${stderr}`);
  }

  if (options.patternIncludes && !stderr.includes(options.patternIncludes)) {
    throw new Error(
      `Expected stderr to include pattern '${options.patternIncludes}', but got:\n${stderr}`
    );
  }
}

/**
 * Asserts that a log entry exists with specific properties
 */
export function expectLogEntry(
  result: HookExecutionResult,
  options: {
    level?: 'INFO' | 'WARNED' | 'BLOCKED';
    hook?: string;
    pattern?: string;
    file?: string;
    messageIncludes?: string;
    suggestionIncludes?: string;
  } = {}
): void {
  const { logEntries } = result;

  if (!logEntries || logEntries.length === 0) {
    throw new Error('Expected log entries, but found none');
  }

  const matchingEntries = logEntries.filter((entry: LogEntry) => {
    if (options.level && entry.level !== options.level) return false;
    if (options.hook && entry.hook !== options.hook) return false;
    if (options.pattern && entry.pattern !== options.pattern) return false;
    if (options.file && entry.file !== options.file) return false;
    if (options.messageIncludes && !entry.message.includes(options.messageIncludes)) {
      return false;
    }
    if (options.suggestionIncludes && !entry.suggestion.includes(options.suggestionIncludes)) {
      return false;
    }
    return true;
  });

  if (matchingEntries.length === 0) {
    const criteria = JSON.stringify(options, null, 2);
    throw new Error(
      `Expected to find log entry matching ${criteria}, ` +
        `but got ${logEntries.length} entries:\n` +
        JSON.stringify(logEntries, null, 2)
    );
  }
}

/**
 * Asserts that no log entries exist with specific properties
 */
export function expectNoLogEntry(
  result: HookExecutionResult,
  options: {
    level?: 'INFO' | 'WARNED' | 'BLOCKED';
    hook?: string;
    pattern?: string;
  } = {}
): void {
  const { logEntries } = result;

  if (!logEntries || logEntries.length === 0) {
    return; // No entries is fine
  }

  const matchingEntries = logEntries.filter((entry: LogEntry) => {
    if (options.level && entry.level !== options.level) return false;
    if (options.hook && entry.hook !== options.hook) return false;
    if (options.pattern && entry.pattern !== options.pattern) return false;
    return true;
  });

  if (matchingEntries.length > 0) {
    const criteria = JSON.stringify(options, null, 2);
    throw new Error(
      `Expected NO log entry matching ${criteria}, ` +
        `but found ${matchingEntries.length} entries:\n` +
        JSON.stringify(matchingEntries, null, 2)
    );
  }
}

/**
 * Asserts JSON output from hooks like ownership-check
 */
export function expectJsonOutput(
  result: HookExecutionResult,
  options: {
    decision?: 'block' | 'allow';
    reasonIncludes?: string;
  } = {}
): void {
  const { stdout } = result;

  let json: unknown;
  try {
    json = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Expected valid JSON output, but got:\n${stdout}`);
  }

  if (options.decision) {
    if (typeof json !== 'object' || json === null) {
      throw new Error(`Expected JSON object, got ${typeof json}`);
    }
    const obj = json as { decision?: string };
    if (obj.decision !== options.decision) {
      throw new Error(`Expected decision '${options.decision}', got '${obj.decision}'`);
    }
  }

  if (options.reasonIncludes) {
    if (typeof json !== 'object' || json === null) {
      throw new Error(`Expected JSON object with reason, got ${typeof json}`);
    }
    const obj = json as { reason?: string };
    if (!obj.reason?.includes(options.reasonIncludes)) {
      throw new Error(
        `Expected reason to include '${options.reasonIncludes}', got '${obj.reason}'`
      );
    }
  }
}

/**
 * Asserts that a hook outputs CONTINUE (for session-start hooks)
 */
export function expectContinue(result: HookExecutionResult): void {
  const { stdout, exitCode } = result;

  if (exitCode !== 0) {
    throw new Error(
      `Expected hook to continue (exit code 0), but got exit code ${exitCode}.\n` +
        `stdout: ${stdout}`
    );
  }

  const trimmed = stdout.trim();
  if (!trimmed.endsWith('CONTINUE')) {
    throw new Error(`Expected output to end with 'CONTINUE', but got:\n${stdout}`);
  }
}

/**
 * Asserts that stderr contains specific text (useful for checking error messages)
 */
export function expectStderrIncludes(result: HookExecutionResult, text: string): void {
  if (!result.stderr.includes(text)) {
    throw new Error(`Expected stderr to include '${text}', but got:\n${result.stderr}`);
  }
}

/**
 * Asserts that stderr does NOT contain specific text
 */
export function expectStderrExcludes(result: HookExecutionResult, text: string): void {
  if (result.stderr.includes(text)) {
    throw new Error(
      `Expected stderr to exclude '${text}', but it was present in:\n${result.stderr}`
    );
  }
}

/**
 * Asserts that a hook soft-blocked via JSON decision (exit 0, stdout contains decision: block)
 * This is different from hard block (exit 2) - used by ownership-check and detect-common-patterns
 */
export function expectSoftBlock(
  result: HookExecutionResult,
  options: {
    reasonIncludes?: string;
    stderrIncludes?: string;
  } = {}
): void {
  const { exitCode, stdout, stderr } = result;

  if (exitCode !== 0) {
    throw new Error(
      `Expected soft block (exit code 0 with JSON decision), but got exit code ${exitCode}.\n` +
        `stdout: ${stdout}\nstderr: ${stderr}`
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Expected JSON output for soft block, but got:\n${stdout}`);
  }

  if (typeof json !== 'object' || json === null) {
    throw new Error(`Expected JSON object, got ${typeof json}`);
  }

  const obj = json as { decision?: string; reason?: string };
  if (obj.decision !== 'block') {
    throw new Error(`Expected decision 'block', got '${obj.decision}'`);
  }

  if (options.reasonIncludes && !obj.reason?.includes(options.reasonIncludes)) {
    throw new Error(
      `Expected reason to include '${options.reasonIncludes}', got '${obj.reason}'`
    );
  }

  if (options.stderrIncludes && !stderr.includes(options.stderrIncludes)) {
    throw new Error(`Expected stderr to include '${options.stderrIncludes}', but got:\n${stderr}`);
  }
}
