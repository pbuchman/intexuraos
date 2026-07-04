import { describe, it, expect } from 'vitest';
import {
  AGENT_CONTRACTS,
  TIER_BY_WORKER,
  type AgentContract,
} from '../../../services/completion-verifier/contracts.js';
import type { CompletionAgentType } from '../../../services/completion-verifier/schemas.js';
import {
  planningPrompt,
  executionPrompt,
  reviewPrompt,
  remediationPrompt,
  pullRequestPrompt,
  sentryPrompt,
} from '../../../services/system-prompt.js';
import type { SystemPromptParams } from '../../../services/prompts/prompt-shared.js';

describe('contracts — canonical field table', () => {
  const expectedAgents: CompletionAgentType[] = [
    'planning',
    'execution',
    'review',
    'remediation',
    'pull_request',
    'sentry',
  ];

  it('has a contract for every verifiable agent type', () => {
    for (const agent of expectedAgents) {
      expect(AGENT_CONTRACTS[agent], `missing contract for ${agent}`).toBeDefined();
    }
  });

  it('every contract has a unique marker', () => {
    const markers = expectedAgents.map((a) => AGENT_CONTRACTS[a].marker);
    expect(new Set(markers).size).toBe(markers.length);
  });

  it('every contract requires the live deliverable fields for its agent', () => {
    for (const agent of expectedAgents) {
      const c: AgentContract = AGENT_CONTRACTS[agent];
      const requiredNames = c.fields.filter((f) => f.required).map((f) => f.name);
      expect(requiredNames).toContain('summary');
      if (agent === 'planning') {
        expect(requiredNames).toContain('linear_issue');
        expect(c.fields.map((f) => f.name)).toContain('plan_doc');
        expect(c.fields.map((f) => f.name)).toContain('plan_pr');
        expect(c.fields.map((f) => f.name)).toContain('clarification_message');
      } else if (agent === 'pull_request') {
        const linearIssueField = c.fields.find((f) => f.name === 'linear_issue');
        expect(requiredNames).toContain('pr');
        expect(requiredNames).toContain('ci_evidence');
        expect(linearIssueField?.required).toBe(false);
        expect(linearIssueField?.emptyAliases).toContain('none');
        expect(requiredNames).toContain('comment_replied');
        expect(requiredNames).toContain('tracking_comment_id');
        expect(requiredNames).toContain('tracking_comment');
        expect(requiredNames).toContain('total_pr_comments_posted');
      } else if (agent === 'review') {
        expect(requiredNames).toContain('pr');
        expect(requiredNames).toContain('review_id');
      } else if (agent === 'sentry') {
        expect(requiredNames).toContain('outcome');
        expect(requiredNames).toContain('pr');
        expect(requiredNames).toContain('sentry_issue');
        expect(requiredNames).toContain('linear_issue');
        expect(requiredNames).toContain('verification');
        expect(requiredNames).toContain('reproduction');
      } else {
        expect(requiredNames).toContain('outcome');
        expect(requiredNames).toContain('pr');
      }
    }
  });

  it('memory fields are NEVER required (telemetry-only, warn-only)', () => {
    for (const agent of expectedAgents) {
      const c = AGENT_CONTRACTS[agent];
      const memoryFields = c.fields.filter((f) =>
        ['memory_ids_used', 'memory_ids_rejected', 'memory_usage_summary'].includes(f.name)
      );
      for (const f of memoryFields) {
        expect(f.required, `${agent}.${f.name} must not be required`).toBe(false);
      }
    }
  });

  it('tier table covers every known WorkerType', () => {
    const workerTypes = [
      'opus',
      'sonnet',
      'auto',
      'glm',
      'minimax',
      'codex',
      'codex-xhigh',
      'kimi',
      'qwen',
      'mimo-pro',
      'openrouter-free',
    ] as const;
    for (const w of workerTypes) {
      expect(TIER_BY_WORKER[w], `missing tier for ${w}`).toMatch(/^(required|optional)$/);
    }
    expect(TIER_BY_WORKER.opus).toBe('required');
    expect(TIER_BY_WORKER.sonnet).toBe('required');
    expect(TIER_BY_WORKER.auto).toBe('required');
    expect(TIER_BY_WORKER.glm).toBe('optional');
  });

  it('execution contract accepts `execution_memory_*` aliases for dual-read compatibility', () => {
    const exec = AGENT_CONTRACTS.execution;
    const used = exec.fields.find((f) => f.name === 'memory_ids_used');
    expect(used?.alias).toContain('execution_memory_ids_used');
    const rejected = exec.fields.find((f) => f.name === 'memory_ids_rejected');
    expect(rejected?.alias).toContain('execution_memory_ids_rejected');
    const summary = exec.fields.find((f) => f.name === 'memory_usage_summary');
    expect(summary?.alias).toContain('execution_memory_usage_summary');
  });

  it('planning and pull_request contracts capture the current prompt-only field labels', () => {
    const planning = AGENT_CONTRACTS.planning;
    expect(planning.fields.find((f) => f.name === 'linear_issue')?.alias).toContain('Linear issue');
    expect(planning.fields.find((f) => f.name === 'plan_pr')?.alias).toContain('Plan PR');

    const pr = AGENT_CONTRACTS.pull_request;
    expect(pr.fields.find((f) => f.name === 'comment_replied')?.alias).toContain('Comment replied');
    expect(pr.fields.find((f) => f.name === 'tracking_comment_id')?.alias).toContain(
      'Tracking comment ID'
    );
    expect(pr.fields.find((f) => f.name === 'total_pr_comments_posted')?.alias).toContain(
      'Total PR comments posted'
    );
  });

  it('planning contract no longer requires complex or subtask fields', () => {
    const fieldNames = AGENT_CONTRACTS.planning.fields.map((field) => field.name);

    expect(fieldNames).toContain('outcome');
    expect(fieldNames).toContain('plan_doc');
    expect(fieldNames).toContain('plan_pr');
    expect(fieldNames).not.toContain('complex_task');
    expect(fieldNames).not.toContain('subtask_urls');
    expect(fieldNames).not.toContain('parallel_breakdown_proof');
  });
});

/**
 * For every agent contract, the generated system prompt must contain
 * the marker line AND every field (by canonical name OR alias). This is
 * the regression guard that would have caught the original
 * execution_memory_* / memory_ids_used split.
 */
describe('contracts — round-trip with every agent prompt', () => {
  const baseParams: SystemPromptParams = {
    taskId: 'task-123',
    linearIssueId: 'INT-123',
    linearIssueLabels: [],
    workerType: 'auto',
  };

  const cases: { agent: CompletionAgentType; build: () => string }[] = [
    { agent: 'planning', build: () => planningPrompt.build(baseParams) },
    { agent: 'execution', build: () => executionPrompt.build(baseParams) },
    { agent: 'review', build: () => reviewPrompt.build(baseParams) },
    { agent: 'remediation', build: () => remediationPrompt.build(baseParams) },
    { agent: 'pull_request', build: () => pullRequestPrompt.build(baseParams) },
    { agent: 'sentry', build: () => sentryPrompt.build(baseParams) },
  ];

  it.each(cases)(
    '$agent prompt contains the marker and every contract field',
    ({ agent, build }) => {
      const prompt = build();
      const contract = AGENT_CONTRACTS[agent];
      expect(prompt).toContain(contract.marker);
      for (const field of contract.fields) {
        const candidates = [field.name, ...(field.alias ?? [])];
        const found = candidates.some((candidate) => prompt.includes(`- ${candidate}:`));
        expect(found, `${agent} prompt missing field ${field.name}`).toBe(true);
      }
    }
  );
});
