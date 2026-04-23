import type { CompletionVerifierVerdict } from '../completion-verifier/types.js';

export type TelemetryExpectation = 'required' | 'optional';

export interface CompletionOutcomeInput {
  verdict: CompletionVerifierVerdict;
  tier: TelemetryExpectation;
  /** Worker Docker exit code if known. undefined → no exit info. */
  exitCode: number | undefined; // @allow-undefined-type -- positional discriminator for the policy function; undefined is a meaningful value distinct from an absent field
  /** Current attempt (1-indexed). Defaults to 1 for decision-only tests. */
  attempt?: number;
  /** Max attempts allowed. Defaults to 3. */
  maxAttempts?: number;
}

export type CompletionOutcome =
  | { kind: 'accept'; telemetryAccepted: boolean }
  | { kind: 'retry'; missingFields: string[] }
  | { kind: 'retry-verifier' }
  | { kind: 'fail'; missingFields: string[] }
  | { kind: 'fail-verifier' }
  | { kind: 'fail-fatal-exit'; field: string }
  | { kind: 'fail-exit-override'; exitCode: number };

/** Field names indicating a fatal worker exit (SIGKILL/SIGSEGV). Set by the verifier short-circuit. */
const FATAL_EXIT_FIELDS = new Set(['fatal_exit_code_137', 'fatal_exit_code_139']);

function findFatalExitField(missingFields: readonly string[]): string | undefined {
  return missingFields.find((f) => FATAL_EXIT_FIELDS.has(f));
}

/**
 * Pure policy function. Given a verdict, worker tier, and exit code, decides what the
 * dispatcher should do next. No side effects — the dispatcher reads the outcome and
 * performs the effect (retry / finalize / log).
 *
 * Precondition: caller has already run the INT-1455 infra-failure classifier and
 * confirmed the attempt is NOT infra-failed. This function assumes a real verifier
 * verdict.
 */
export function decideCompletionOutcome(input: CompletionOutcomeInput): CompletionOutcome {
  const { verdict, tier, exitCode } = input;
  const attempt = input.attempt ?? 1;
  const maxAttempts = input.maxAttempts ?? 3;

  // 1. Verifier failure (all validation LLMs down) — retry verifier only, don't rerun worker.
  if (verdict.verifierFailure) {
    if (attempt < maxAttempts) {
      return { kind: 'retry-verifier' };
    }
    return { kind: 'fail-verifier' };
  }

  // 2. Fatal exit codes surface as blocking fields — terminal, no retry.
  const fatalField = findFatalExitField(verdict.missingFields);
  if (fatalField !== undefined) {
    return { kind: 'fail-fatal-exit', field: fatalField };
  }

  // 3. Exit-code override: a non-zero exit overrides any claim of success.
  //    Applies whether or not the verdict otherwise looks clean.
  if (exitCode !== undefined && exitCode !== 0) {
    return { kind: 'fail-exit-override', exitCode };
  }

  // 4. Verifier passed and agentData present → accept.
  if (verdict.passed && verdict.agentData !== undefined) {
    return { kind: 'accept', telemetryAccepted: false };
  }

  // 5. Only telemetry missing + tier=optional + agentData present → accept with flag.
  const blockingMissing = verdict.missingFields;
  const telemetryMissing = verdict.telemetryMissingFields;
  const onlyTelemetry =
    blockingMissing.length === 0 && telemetryMissing.length > 0 && verdict.agentData !== undefined;
  if (onlyTelemetry && tier === 'optional') {
    return { kind: 'accept', telemetryAccepted: true };
  }

  // 6. Anything missing (blocking, telemetry, or both) — retry or fail based on attempts.
  const allMissing = [...blockingMissing, ...telemetryMissing];
  if (allMissing.length > 0) {
    if (attempt < maxAttempts) {
      return { kind: 'retry', missingFields: allMissing };
    }
    return { kind: 'fail', missingFields: allMissing };
  }

  // 7. Fallback: passed is false but no missing fields and no agentData (shouldn't happen
  //    with a correct verifier; treat as a generic fail).
  return { kind: 'fail', missingFields: [] };
}
