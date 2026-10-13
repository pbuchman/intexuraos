import type { Task, TaskError } from '../../types/task.js';

/**
 * Builds the "Non-zero exit code: N; {runtime} error: {msg}" message used by
 * runtime hard-error paths — the normal completion path (`handleTaskCompletion`)
 * and the resumed-after-success path (`handleResumedAfterSuccessCompletion`).
 *
 * Returns an empty string when no concrete runtime evidence is available so
 * callers can decide how to fall back to a generic message.
 *
 * An empty `claudeError` is treated the same as `undefined`: the runtime
 * log-processor defaults missing error messages to the literal `'Task failed'`,
 * but a future adapter could emit an empty string and we would not want to
 * surface a dangling `"{runtime} error: "` with no content.
 */
export function buildRuntimeHardErrorMessage(args: {
  exitCode: number | undefined; // @allow-undefined-type -- upstream taskExitCodes.get() returns number | undefined; caller always passes the raw value
  claudeError: string | undefined; // @allow-undefined-type -- upstream claudeErrors.get() returns string | undefined; caller always passes the raw value
  runtimeName: string;
}): string {
  const parts: string[] = [];
  if (
    args.claudeError !== undefined &&
    /hit your (?:usage )?limit|usage limit/i.test(args.claudeError)
  ) {
    // Keep the provider's reset time intact and put it before generic exit/verifier details.
    const exit =
      args.exitCode === undefined || args.exitCode === 0
        ? ''
        : `; Non-zero exit code: ${String(args.exitCode)}`;
    return `${args.runtimeName} usage limit exceeded: ${args.claudeError}${exit}`;
  }
  if (typeof args.exitCode === 'number' && args.exitCode !== 0) {
    parts.push(`Non-zero exit code: ${String(args.exitCode)}`);
  }
  if (args.claudeError !== undefined && args.claudeError !== '') {
    parts.push(`${args.runtimeName} error: ${args.claudeError}`);
  }
  return parts.join('; ');
}

/** Missing Sentry evidence is terminal; actual runtime failures retain their existing retry policy. */
export function buildAgentFailureError(
  agentType: Task['agentType'],
  failureReason: string,
  message: string,
  runtimeError?: string
): TaskError {
  if (
    agentType === 'sentry' &&
    failureReason.startsWith('SENTRY_EVIDENCE_UNAVAILABLE:') &&
    !runtimeError
  ) {
    return { code: 'SENTRY_EVIDENCE_UNAVAILABLE', message: failureReason };
  }
  return { code: 'TASK_RUNTIME_HARD_ERROR', message, remediation: { action: 'retry' } };
}
