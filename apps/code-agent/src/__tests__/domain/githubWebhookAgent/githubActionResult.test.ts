import { describe, it, expect } from 'vitest';
import {
  evaluateWorkflowRepairEligibility,
  type RepairEligibilityInput,
} from '../../../domain/githubWebhookAgent/eventFamilies/githubActionResult.js';

function makeInput(overrides: Partial<RepairEligibilityInput> = {}): RepairEligibilityInput {
  return {
    eventType: 'workflow_run',
    action: 'completed',
    state: 'completed/failure',
    pullRequestNumber: 42,
    repository: 'pbuchman/intexuraos',
    senderLogin: 'github-actions[bot]',
    ...overrides,
  };
}

describe('evaluateWorkflowRepairEligibility', () => {
  describe('eligible failed workflow triggers repair', () => {
    it('returns eligible for failed workflow_run on PR', () => {
      const result = evaluateWorkflowRepairEligibility(makeInput(), {
        isRepairDuplicate: (): boolean => false,
        isProtectedBranch: (): boolean => false,
      });

      expect(result.eligible).toBe(true);
      expect(result.decisionKind).toBe('create_code_action');
    });

    it('includes repair context in result', () => {
      const result = evaluateWorkflowRepairEligibility(makeInput(), {
        isRepairDuplicate: (): boolean => false,
        isProtectedBranch: (): boolean => false,
      });

      expect(result.eligible).toBe(true);
      expect(result.reasonCode).toBe('workflow_failure_eligible');
    });
  });

  describe('duplicate workflow run suppressed', () => {
    it('returns ineligible when repair is duplicate', () => {
      const result = evaluateWorkflowRepairEligibility(makeInput(), {
        isRepairDuplicate: (): boolean => true,
        isProtectedBranch: (): boolean => false,
      });

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('duplicate_repair');
      expect(result.decisionKind).toBe('noop');
    });
  });

  describe('protected branch denied', () => {
    it('returns ineligible for protected branch', () => {
      const result = evaluateWorkflowRepairEligibility(makeInput(), {
        isRepairDuplicate: (): boolean => false,
        isProtectedBranch: (): boolean => true,
      });

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('protected_branch_denied');
      expect(result.decisionKind).toBe('noop');
    });
  });

  describe('ineligible events', () => {
    it('returns ineligible for non-workflow_run event type', () => {
      const result = evaluateWorkflowRepairEligibility(
        makeInput({ eventType: 'check_run' }),
        {
          isRepairDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('unsupported_ci_event');
    });

    it('returns ineligible for non-completed action', () => {
      const result = evaluateWorkflowRepairEligibility(
        makeInput({ action: 'requested' }),
        {
          isRepairDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('not_completed');
    });

    it('returns ineligible for successful workflow', () => {
      const result = evaluateWorkflowRepairEligibility(
        makeInput({ state: 'completed/success' }),
        {
          isRepairDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('not_failed');
    });

    it('returns ineligible when no PR linkage', () => {
      const result = evaluateWorkflowRepairEligibility(
        makeInput({ pullRequestNumber: 0 }),
        {
          isRepairDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('no_pr_linkage');
    });

    it('returns ineligible for state without conclusion separator', () => {
      const result = evaluateWorkflowRepairEligibility(
        makeInput({ state: 'completed' }),
        {
          isRepairDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('not_failed');
    });

    it('returns ineligible for null state', () => {
      const result = evaluateWorkflowRepairEligibility(
        makeInput({ state: null }),
        {
          isRepairDuplicate: (): boolean => false,
          isProtectedBranch: (): boolean => false,
        }
      );

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe('not_failed');
    });
  });
});
