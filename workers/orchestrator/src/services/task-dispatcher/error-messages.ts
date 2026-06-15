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
  if (typeof args.exitCode === 'number' && args.exitCode !== 0) {
    parts.push(`Non-zero exit code: ${String(args.exitCode)}`);
  }
  if (args.claudeError !== undefined && args.claudeError !== '') {
    parts.push(`${args.runtimeName} error: ${args.claudeError}`);
  }
  return parts.join('; ');
}
