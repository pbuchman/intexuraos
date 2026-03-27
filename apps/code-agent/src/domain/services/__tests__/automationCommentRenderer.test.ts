import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AutomationEvent } from '../../ports/automationLog.js';
import {
  renderHeader,
  renderEvent,
} from '../automationCommentRenderer.js';

/**
 * Helper: create a fixed Date for deterministic timestamps.
 * 14:35 UTC
 */
function useFakeTime(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-14T14:35:00Z'));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('renderHeader', () => {
  it('returns the @ignore marker and title', () => {
    const result = renderHeader();
    expect(result).toBe('@ignore\n### IntexuraOS Automation\n');
  });
});

describe('renderEvent', () => {
  describe('webhook_received', () => {
    it('renders event type, action, and sender', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'webhook_received',
        eventType: 'pull_request',
        action: 'opened',
        sender: 'octocat',
        deliveryId: 'abc-123',
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- `pull_request.opened` by @octocat');
    });

    it('renders event type as link when eventUrl is present', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'webhook_received',
        eventType: 'issue_comment',
        action: 'created',
        sender: 'octocat',
        deliveryId: 'abc-123',
        eventUrl: 'https://github.com/pbuchman/intexuraos/pull/42#issuecomment-123',
      };

      const result = renderEvent(event);
      expect(result).toBe(
        '**14:35** -- [`issue_comment.created`](https://github.com/pbuchman/intexuraos/pull/42#issuecomment-123) by @octocat'
      );
    });

    it('appends summary when present', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'webhook_received',
        eventType: 'issue_comment',
        action: 'created',
        sender: 'octocat',
        deliveryId: 'abc-123',
        summary: '@ignore Automated Code review',
      };

      const result = renderEvent(event);
      expect(result).toBe(
        '**14:35** -- `issue_comment.created` by @octocat \u2014 @ignore Automated Code review'
      );
    });

    it('renders both eventUrl and summary when both present', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'webhook_received',
        eventType: 'pull_request_review',
        action: 'submitted',
        sender: 'reviewer',
        deliveryId: 'abc-123',
        eventUrl: 'https://github.com/pbuchman/intexuraos/pull/42#pullrequestreview-1',
        summary: 'APPROVED: Looks good',
      };

      const result = renderEvent(event);
      expect(result).toBe(
        '**14:35** -- [`pull_request_review.submitted`](https://github.com/pbuchman/intexuraos/pull/42#pullrequestreview-1) by @reviewer \u2014 APPROVED: Looks good'
      );
    });
  });

  describe('skipped', () => {
    it('returns null for webhook_route skip (deterministic noise)', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'skipped',
        decidedBy: 'webhook_route',
        reason: 'UNSUPPORTED_EVENT',
      };

      const result = renderEvent(event);
      expect(result).toBeNull();
    });

    it('returns null for hard_rules skip (deterministic noise)', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'skipped',
        decidedBy: 'hard_rules',
        reason: 'PROTECTED_BASE_BRANCH',
        ruleName: 'ProtectedBaseBranchRule',
      };

      const result = renderEvent(event);
      expect(result).toBeNull();
    });

    it('renders cost, reasoning, and tool calls for llm_triage skip', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'skipped',
        decidedBy: 'llm_triage',
        reason: 'NO_ACTION_NEEDED',
        cost: 0.042,
        reasoning: 'This is a documentation-only change.',
        toolCalls: ['readFile(README.md)', 'getDiff()'],
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- **Skipped** | NO_ACTION_NEEDED');
      expect(result).toContain('<details>');
      expect(result).toContain('Cost: $0.042');
      expect(result).toContain('This is a documentation-only change.');
      expect(result).toContain('- `readFile(README.md)`');
      expect(result).toContain('- `getDiff()`');
    });

    it('renders without optional fields when missing', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'skipped',
        decidedBy: 'llm_triage',
        reason: 'NO_ACTION_NEEDED',
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- **Skipped** | NO_ACTION_NEEDED');
      expect(result).not.toContain('<details>');
    });

    it('handles empty tool calls array', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'skipped',
        decidedBy: 'llm_triage',
        reason: 'NO_ACTION_NEEDED',
        cost: 0.01,
        reasoning: 'Trivial change.',
        toolCalls: [],
      };

      const result = renderEvent(event);
      expect(result).toContain('Cost: $0.010');
      expect(result).toContain('Trivial change.');
      // No tool calls section when array is empty
      expect(result).not.toContain('Tool calls');
    });
  });

  describe('triage_dispatch', () => {
    it('renders review dispatch with review types', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'triage_dispatch',
        reviewTypes: ['code_review', 'architecture'],
        cost: 0.123,
        reasoning: 'Complex PR needs thorough review.',
        toolCalls: ['readFile(src/index.ts)', 'getDiff()'],
      };

      const result = renderEvent(event);
      expect(result).toContain(
        '**14:35** -- Triage -> **Dispatching review** (`code_review, architecture`)'
      );
      expect(result).toContain('<details>');
      expect(result).toContain('Cost: $0.123');
      expect(result).toContain('Complex PR needs thorough review.');
      expect(result).toContain('- `readFile(src/index.ts)`');
      expect(result).toContain('- `getDiff()`');
    });

    it('renders task dispatch when no reviewTypes', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'triage_dispatch',
        workerType: 'opus',
        cost: 0.05,
        reasoning: 'Needs implementation.',
        toolCalls: [],
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- Triage -> **Dispatching task**');
      expect(result).not.toContain('Dispatching review');
    });
  });

  describe('triage_failed', () => {
    it('renders fallback action and error in details', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'triage_failed',
        error: 'LLM timeout after 30s',
        fallbackAction: 'dispatch',
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- **Triage failed** | dispatch');
      expect(result).toContain('<details>');
      expect(result).toContain('LLM timeout after 30s');
    });
  });

  describe('task_dispatched', () => {
    it('renders task ID with link and worker type', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_dispatched',
        taskId: 'task_abc123',
        workerType: 'opus',
        agentType: 'execution',
      };

      const result = renderEvent(event);
      expect(result).toBe(
        '**14:35** -- Task dispatched: [`task_abc123`](https://intexuraos.cloud/#/code-tasks/task_abc123) | opus'
      );
    });
  });

  describe('remediation_decision', () => {
    it('renders remediation not required', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'remediation_decision',
        required: false,
        source: 'review_result',
        signal: '0',
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- Remediation not required');
    });

    it('renders remediation required with dispatched task link', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'remediation_decision',
        required: true,
        source: 'review_result',
        signal: '1',
        taskId: 'task_rem_123',
      };

      const result = renderEvent(event);
      expect(result).toBe(
        '**14:35** -- Remediation required | dispatched: [`task_rem_123`](https://intexuraos.cloud/#/code-tasks/task_rem_123)'
      );
    });

    it('renders remediation required with existing remediation task link', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'remediation_decision',
        required: true,
        source: 'review_result',
        signal: '1',
        existingTaskId: 'task_existing_456',
      };

      const result = renderEvent(event);
      expect(result).toBe(
        '**14:35** -- Remediation required | recent remediation task already exists: [`task_existing_456`](https://intexuraos.cloud/#/code-tasks/task_existing_456)'
      );
    });

    it('renders fail-open remediation requirement when review signal is missing', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'remediation_decision',
        required: true,
        source: 'review_result',
        signal: 'missing',
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- Remediation required (review signal missing, fail-open)');
    });

    it('renders remediation required without task link when no remediation task id is available', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'remediation_decision',
        required: true,
        source: 'review_result',
        signal: '1',
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- Remediation required');
    });
  });

  describe('task_dispatch_failed', () => {
    it('renders error and errorCode in details', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_dispatch_failed',
        error: 'Rate limit exceeded',
        errorCode: 'RATE_LIMIT',
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- **Dispatch failed**');
      expect(result).toContain('<details>');
      expect(result).toContain('Rate limit exceeded');
      expect(result).toContain('RATE_LIMIT');
    });

    it('renders without errorCode when missing', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_dispatch_failed',
        error: 'Unknown error',
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- **Dispatch failed**');
      expect(result).toContain('Unknown error');
      expect(result).not.toContain('Code:');
    });
  });

  describe('task_started', () => {
    it('renders attempt number', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_started',
        taskId: 'task_abc123',
        workerType: 'opus',
        attempt: 2,
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- Task started | attempt 2');
    });
  });

  describe('task_completed', () => {
    it('renders duration and PR link', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_completed',
        taskId: 'task_abc123',
        status: 'implemented',
        duration: 522_000, // 8m 42s
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/99',
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- **Completed** | 8m 42s | [PR #99](https://github.com/pbuchman/intexuraos/pull/99)');
    });

    it('renders commits with links when repository provided', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_completed',
        taskId: 'task_abc123',
        status: 'implemented',
        duration: 60_000,
        commits: [
          { sha: 'abc1234567890', message: 'Add feature' },
          { sha: 'def4567890123', message: 'Fix tests' },
        ],
      };

      const result = renderEvent(event, { repository: 'pbuchman/intexuraos' });
      expect(result).toContain('<details>');
      expect(result).toContain(
        '- [`abc1234`](https://github.com/pbuchman/intexuraos/commit/abc1234567890) Add feature'
      );
      expect(result).toContain(
        '- [`def4567`](https://github.com/pbuchman/intexuraos/commit/def4567890123) Fix tests'
      );
    });

    it('renders commits without links when no repository', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_completed',
        taskId: 'task_abc123',
        status: 'implemented',
        duration: 60_000,
        commits: [{ sha: 'abc1234567890', message: 'Add feature' }],
      };

      const result = renderEvent(event);
      expect(result).toContain('- `abc1234` Add feature');
      expect(result).not.toContain('https://github.com');
    });

    it('renders without PR link when prUrl is missing', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_completed',
        taskId: 'task_abc123',
        status: 'implemented',
        duration: 3_723_000, // 1h 2m 3s -> "1h 2m"
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- **Completed** | 1h 2m');
      expect(result).not.toContain('PR #');
      expect(result).not.toContain('<details>');
    });

    it('renders without commits section when commits is empty', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_completed',
        taskId: 'task_abc123',
        status: 'implemented',
        duration: 60_000,
        commits: [],
      };

      const result = renderEvent(event);
      expect(result).not.toContain('<details>');
    });

    it('formats zero duration', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_completed',
        taskId: 'task_abc123',
        status: 'implemented',
        duration: 0,
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- **Completed** | 0s');
    });
  });

  describe('task_failed', () => {
    it('renders duration and errorCode', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_failed',
        taskId: 'task_abc123',
        error: 'Worker crashed',
        errorCode: 'WORKER_CRASH',
        duration: 45_000,
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- **Failed** | 45s | WORKER_CRASH');
      expect(result).toContain('<details>');
      expect(result).toContain('Worker crashed');
    });

    it('renders without duration and errorCode when missing', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_failed',
        taskId: 'task_abc123',
        error: 'Something went wrong',
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- **Failed**');
      expect(result).not.toContain(' | 0s');
      expect(result).toContain('Something went wrong');
    });
  });

  describe('task_interrupted', () => {
    it('renders with duration', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_interrupted',
        taskId: 'task_abc123',
        duration: 120_000,
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- **Interrupted** | 2m 0s');
    });

    it('renders without duration when missing', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_interrupted',
        taskId: 'task_abc123',
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- **Interrupted**');
    });
  });

  describe('linear_issue_failed', () => {
    it('renders warning emoji and error message', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'linear_issue_failed',
        error: 'Usage limit exceeded',
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- ⚠️ Linear issue creation failed | Usage limit exceeded');
    });
  });

  describe('review_replaced', () => {
    it('renders replaced task ID', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'review_replaced',
        replacedTaskId: 'task_old456',
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- Review cancelled (replaced) | task_old456');
    });
  });

  describe('ci_failure_detected', () => {
    it('renders CI failure with check name, branch, and conclusion', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'ci_failure_detected',
        checkName: 'ESLint',
        conclusion: 'failure',
        headBranch: 'task_abc123',
        headSha: 'abc123def',
        checkSuiteId: 123,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/99',
      };

      const result = renderEvent(event);
      expect(result).toBe(
        '**14:35** -- ⚠️ CI check failed: ESLint | branch: task_abc123 | failure'
      );
    });
  });

  describe('fix_task_dispatched', () => {
    it('renders fix task dispatched with parent and fix task IDs', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'fix_task_dispatched',
        parentTaskId: 'task_parent456',
        fixTaskId: 'task_fix789',
        checkName: 'ESLint',
      };

      const result = renderEvent(event);
      expect(result).toBe(
        '**14:35** -- Fix task dispatched for CI failure | parent: `task_parent456` → fix: `task_fix789`'
      );
    });
  });

  describe('ci_failure_skip', () => {
    it('renders CI failure skip with reason', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'ci_failure_skip',
        reason: 'already_follow_up',
      };

      const result = renderEvent(event);
      expect(result).toBe('**14:35** -- CI failure skip: already_follow_up');
    });
  });

  describe('duration formatting', () => {
    it('formats seconds only', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_completed',
        taskId: 't',
        status: 'implemented',
        duration: 5_000,
      };
      expect(renderEvent(event)).toContain('5s');
    });

    it('formats minutes and seconds', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_completed',
        taskId: 't',
        status: 'implemented',
        duration: 522_000,
      };
      expect(renderEvent(event)).toContain('8m 42s');
    });

    it('formats hours and minutes (drops seconds)', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'task_completed',
        taskId: 't',
        status: 'implemented',
        duration: 3_723_000,
      };
      expect(renderEvent(event)).toContain('1h 2m');
    });
  });

  describe('edge cases', () => {
    it('handles long reasoning text', () => {
      useFakeTime();
      const longReasoning = 'A'.repeat(2000);
      const event: AutomationEvent = {
        type: 'triage_dispatch',
        reviewTypes: ['code_review'],
        cost: 0.5,
        reasoning: longReasoning,
        toolCalls: [],
      };

      const result = renderEvent(event);
      expect(result).toContain(longReasoning);
    });

    it('renders skipped event with all optional fields populated', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'skipped',
        decidedBy: 'llm_triage',
        reason: 'LOW_PRIORITY',
        ruleName: 'PriorityRule',
        cost: 0.033,
        reasoning: 'This is a minor formatting change.',
        toolCalls: ['getDiff()', 'readFile(package.json)'],
      };

      const result = renderEvent(event);
      expect(result).toContain('**14:35** -- **Skipped** | LOW_PRIORITY');
      expect(result).toContain('Rule: PriorityRule');
      expect(result).toContain('Cost: $0.033');
      expect(result).toContain('This is a minor formatting change.');
      expect(result).toContain('- `getDiff()`');
      expect(result).toContain('- `readFile(package.json)`');
    });

    it('formats cost with 3 decimal places', () => {
      useFakeTime();
      const event: AutomationEvent = {
        type: 'triage_dispatch',
        reviewTypes: ['code_review'],
        cost: 1,
        reasoning: 'Expensive.',
        toolCalls: [],
      };

      const result = renderEvent(event);
      expect(result).toContain('Cost: $1.000');
    });
  });
});
