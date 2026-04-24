import { describe, it, expect } from 'vitest';
import {
  decideCompletionOutcome,
  type OutcomeVerdictView,
} from '../../../services/task-dispatcher/decide-outcome.js';

function baseVerdict(overrides: Partial<OutcomeVerdictView> = {}): OutcomeVerdictView {
  return {
    passed: false,
    missingFields: [],
    telemetryMissingFields: [],
    agentData: undefined,
    ...overrides,
  };
}

describe('[INT-1461/INT-1470] decideCompletionOutcome', () => {
  describe('success paths', () => {
    it('accept when verifier passed and exit code is 0', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ passed: true, agentData: { outcome: 'implemented' } }),
        tier: 'required',
        exitCode: 0,
      });
      expect(out).toEqual({ kind: 'accept', telemetryAccepted: false });
    });

    it('accept when passed and exit code undefined', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ passed: true, agentData: { outcome: 'implemented' } }),
        tier: 'optional',
        exitCode: undefined,
      });
      expect(out.kind).toBe('accept');
    });
  });

  describe('tier=optional telemetry-only missing', () => {
    it('accept and flag telemetryAccepted when only telemetry missing and exit code 0', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: [],
          telemetryMissingFields: ['memory_acknowledgment'],
          agentData: { outcome: 'implemented' },
        }),
        tier: 'optional',
        exitCode: 0,
      });
      expect(out).toEqual({ kind: 'accept', telemetryAccepted: true });
    });

    it('accept when exit code undefined (no worker exit info)', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryMissingFields: ['memory_acknowledgment'],
          agentData: { outcome: 'implemented' },
        }),
        tier: 'optional',
        exitCode: undefined,
      });
      expect(out.kind).toBe('accept');
    });

    it('fail-exit-override when exit code non-zero, even if verdict is telemetry-only', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          telemetryMissingFields: ['memory_acknowledgment'],
          agentData: { outcome: 'implemented' },
        }),
        tier: 'optional',
        exitCode: 1,
      });
      expect(out.kind).toBe('fail-exit-override');
      if (out.kind === 'fail-exit-override') {
        expect(out.exitCode).toBe(1);
      }
    });

    it('does NOT accept if agentData missing (nothing to build a result from)', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ telemetryMissingFields: ['memory_acknowledgment'] }),
        tier: 'optional',
        exitCode: 0,
      });
      expect(out.kind).not.toBe('accept');
    });
  });

  describe('[INT-1470] tier=required telemetry-only missing', () => {
    it('accept with telemetryAccepted=true (was: retry 3× then fail)', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: [],
          telemetryMissingFields: ['memory_ids_used', 'memory_ids_rejected'],
          agentData: { outcome: 'implemented' },
        }),
        tier: 'required',
        exitCode: 0,
      });
      expect(out).toEqual({ kind: 'accept', telemetryAccepted: true });
    });

    it('does NOT accept if agentData missing on tier=required telemetry-only (parity with optional)', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ telemetryMissingFields: ['memory_acknowledgment'] }),
        tier: 'required',
        exitCode: 0,
      });
      expect(out.kind).not.toBe('accept');
    });
  });

  describe('blocking missing (any tier)', () => {
    it('retry when blocking present and attempts remain, tier=optional', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: ['gh_pr_url'],
          telemetryMissingFields: [],
        }),
        tier: 'optional',
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('retry');
      if (out.kind === 'retry') {
        expect(out.missingFields).toEqual(['gh_pr_url']);
      }
    });

    it('retry with union when both blocking and telemetry present', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: ['gh_pr_url'],
          telemetryMissingFields: ['memory_acknowledgment'],
        }),
        tier: 'required',
        exitCode: 0,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('retry');
      if (out.kind === 'retry') {
        expect(out.missingFields).toEqual(['gh_pr_url', 'memory_acknowledgment']);
      }
    });

    it('terminal fail when out of attempts and blocking missing', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: ['gh_pr_url'],
          telemetryMissingFields: [],
        }),
        tier: 'optional',
        exitCode: 0,
        attempt: 3,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('fail');
    });
  });

  describe('fatal exit codes', () => {
    it('fail without retry when missingFields contains fatal_exit_code_137', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: ['fatal_exit_code_137'],
          telemetryMissingFields: [],
        }),
        tier: 'optional',
        exitCode: undefined,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(out.kind).toBe('fail-fatal-exit');
      if (out.kind === 'fail-fatal-exit') {
        expect(out.field).toBe('fatal_exit_code_137');
      }
    });

    it('fail without retry for fatal_exit_code_139', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({
          missingFields: ['fatal_exit_code_139'],
          telemetryMissingFields: [],
        }),
        tier: 'required',
        exitCode: undefined,
      });
      expect(out.kind).toBe('fail-fatal-exit');
    });
  });

  describe('exit-code override', () => {
    it('fail-exit-override when verdict passed but exit code non-zero', () => {
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ passed: true, agentData: { outcome: 'implemented' } }),
        tier: 'required',
        exitCode: 1,
      });
      expect(out.kind).toBe('fail-exit-override');
      if (out.kind === 'fail-exit-override') {
        expect(out.exitCode).toBe(1);
      }
    });
  });

  describe('fallback guard', () => {
    it('returns generic fail when verdict is not passed, no missing fields, and no agentData', () => {
      // Degenerate verdict that the real verifier cannot produce — exercised here purely so the
      // policy function never silently "succeeds" on a malformed verdict.
      const out = decideCompletionOutcome({
        verdict: baseVerdict({ passed: false }),
        tier: 'required',
        exitCode: 0,
      });
      expect(out).toEqual({ kind: 'fail', missingFields: [] });
    });
  });
});
