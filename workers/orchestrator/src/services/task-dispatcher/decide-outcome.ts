export type TelemetryExpectation = 'required' | 'optional';

/**
 * Simplified verdict view used by the outcome policy.
 *
 * Post-INT-1470 the verifier is deterministic and the kind='hard-error' case
 * is handled directly in the dispatcher before this function is called —
 * we never observe a verifier-failure variant here.
 */
export interface OutcomeVerdictView {
  passed: boolean;
  missingFields: string[];
  telemetryMissingFields: string[];
  /**
   * Parsed/coerced agent data (Record<string, unknown>). Present when the
   * AGENT_FINAL block was successfully parsed.
   */
  agentData: Record<string, unknown> | undefined; // @allow-undefined-type -- positional optional; undefined means "no parsed block"
}

export interface CompletionOutcomeInput {
  verdict: OutcomeVerdictView;
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
  | { kind: 'fail'; missingFields: string[] }
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
 * confirmed the attempt is NOT infra-failed. Also, post-INT-1470, caller has
 * already handled the kind='hard-error' verifier branch; this function assumes
 * a parsed verdict.
 */
export function decideCompletionOutcome(input: CompletionOutcomeInput): CompletionOutcome {
  // [INT-1470] tier is no longer read in the policy (tier-aware accept was
  // unified — both tier=optional and tier=required accept telemetry-only
  // misses). The parameter is preserved in the input shape for caller compat
  // and potential future tier-specific policy additions.
  const { verdict, exitCode } = input;
  const attempt = input.attempt ?? 1;
  const maxAttempts = input.maxAttempts ?? 3;

  // 1. Fatal exit codes surface as blocking fields — terminal, no retry.
  const fatalField = findFatalExitField(verdict.missingFields);
  if (fatalField !== undefined) {
    return { kind: 'fail-fatal-exit', field: fatalField };
  }

  // 2. Exit-code override: a non-zero exit overrides any claim of success.
  //    Applies whether or not the verdict otherwise looks clean.
  if (exitCode !== undefined && exitCode !== 0) {
    return { kind: 'fail-exit-override', exitCode };
  }

  // 3. Telemetry-only miss (deliverable OK, memory fields empty) → accept with flag.
  //    Applies to both tier=optional (always accepted) and tier=required
  //    ([INT-1470]: previously retried 3× then failed; now accepts per "skip > fail").
  const blockingMissing = verdict.missingFields;
  const telemetryMissing = verdict.telemetryMissingFields;
  const onlyTelemetry =
    blockingMissing.length === 0 && telemetryMissing.length > 0 && verdict.agentData !== undefined;
  if (onlyTelemetry) {
    return { kind: 'accept', telemetryAccepted: true };
  }

  // 4. Verifier passed cleanly (no missingRequired, no telemetry issues) → accept.
  if (verdict.passed && verdict.agentData !== undefined) {
    return { kind: 'accept', telemetryAccepted: false };
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
