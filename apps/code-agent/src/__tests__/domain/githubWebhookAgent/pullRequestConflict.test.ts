import { describe, it, expect } from 'vitest';
import {
  evaluateConflictResolutionEligibility,
  type ConflictEligibilityInput,
} from '../../../domain/githubWebhookAgent/eventFamilies/pullRequest.js';

function makeInput(overrides: Partial<ConflictEligibilityInput> = {}): ConflictEligibilityInput {
  return {
    eventType: 'pull_request',
    action: 'synchronize',
    mergeableState: 'dirty',
    pullRequestNumber: 42,
    repository: 'pbuchman/intexuraos',
    senderLogin: 'testuser',
    ...overrides,
  };
}

describe('evaluateConflictResolutionEligibility', () => {
  describe('conflict detected routes action', () => {
    it('returns eligible with create_code_action for dirty mergeableState', () => {
      const result = evaluateConflictResolutionEligibility(makeInput(), {
        isConflictDuplicate: (): boolean => false,
        isProtectedBranch: (): boolean => false,
      });

      expect(result.eligible).toBe(true);
      expect(result.decisionKind).toBe('create_code_action');
      expect(result.reasonCode).toBe('conflict_detected');
    });

    it('includes conflict-resolution instructions in result', () => {
      const result = evaluateConflictResolutionEligibility(makeInput(), {
        isConflictDuplicate: (): boolean => false,
        isProtectedBranch: (): boolean => false,
      });

      expect(result.eligible).toBe(true);
      expect(result.intent).toBe('conflict_resolution');
      expect(result.reasoning).toContain('PR #42');
    });
  });

  describe('unknown mergeability deferred', () => {
    it('returns deferred for unknown mergeableState', () => {
      const result = evaluateConflictResolutionEligibility(
        makeInput({ mergeableState: 'unknown' }),
        {
          isConflictDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.decisionKind).toBe('noop');
      expect(result.reasonCode).toBe('mergeability_unknown');
      expect(result.deferred).toBe(true);
    });

    it('returns deferred for null mergeableState', () => {
      const result = evaluateConflictResolutionEligibility(
        makeInput({ mergeableState: null }),
        {
          isConflictDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.deferred).toBe(true);
      expect(result.reasonCode).toBe('mergeability_unknown');
    });
  });

  describe('duplicate conflict action suppressed', () => {
    it('returns ineligible when conflict action is duplicate', () => {
      const result = evaluateConflictResolutionEligibility(makeInput(), {
        isConflictDuplicate: (): boolean => true,
        isProtectedBranch: (): boolean => false,
      });

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('duplicate_conflict_action');
      expect(result.decisionKind).toBe('noop');
    });
  });

  describe('ineligible events', () => {
    it('returns ineligible for non-pull_request event type', () => {
      const result = evaluateConflictResolutionEligibility(
        makeInput({ eventType: 'issue_comment' }),
        {
          isConflictDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('unsupported_event_type');
    });

    it('returns ineligible for clean mergeableState', () => {
      const result = evaluateConflictResolutionEligibility(
        makeInput({ mergeableState: 'clean' }),
        {
          isConflictDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('no_conflict');
    });

    it('returns ineligible for protected branch', () => {
      const result = evaluateConflictResolutionEligibility(makeInput(), {
        isConflictDuplicate: (): boolean => false,
        isProtectedBranch: (): boolean => true,
      });

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('protected_branch_denied');
    });

    it('returns ineligible when no PR linkage', () => {
      const result = evaluateConflictResolutionEligibility(
        makeInput({ pullRequestNumber: 0 }),
        {
          isConflictDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('no_pr_linkage');
    });

    it('returns no_conflict for unrecognized mergeableState', () => {
      const result = evaluateConflictResolutionEligibility(
        makeInput({ mergeableState: 'some_future_state' }),
        {
          isConflictDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('no_conflict');
    });

    it('returns no_conflict for unstable mergeableState', () => {
      const result = evaluateConflictResolutionEligibility(
        makeInput({ mergeableState: 'unstable' }),
        {
          isConflictDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('no_conflict');
    });
  });
});
