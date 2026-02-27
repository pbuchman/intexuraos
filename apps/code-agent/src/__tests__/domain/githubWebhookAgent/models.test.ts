import { describe, it, expect } from 'vitest';
import {
  WorkerTypeSchema,
  WebhookEventGroupSchema,
  WebhookAgentDecisionSchema,
  WebhookActionPlanSchema,
  WebhookActionStepResultSchema,
  WebhookAgentRunRecordSchema,
} from '../../../domain/githubWebhookAgent/models.js';

describe('WorkerTypeSchema', () => {
  it('accepts valid worker types', () => {
    for (const t of ['auto', 'opus', 'sonnet', 'minimax', 'glm'] as const) {
      expect(WorkerTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects unknown worker type', () => {
    const result = WorkerTypeSchema.safeParse('gpt4');
    expect(result.success).toBe(false);
  });
});

describe('WebhookEventGroupSchema', () => {
  it('accepts valid event groups', () => {
    for (const g of ['pull_request', 'comment', 'github_action_result', 'other'] as const) {
      expect(WebhookEventGroupSchema.parse(g)).toBe(g);
    }
  });

  it('rejects invalid event group', () => {
    const result = WebhookEventGroupSchema.safeParse('workflow_run');
    expect(result.success).toBe(false);
  });
});

describe('WebhookAgentDecisionSchema', () => {
  const validDecision = {
    version: '1.0' as const,
    eventGroup: 'comment' as const,
    actionability: 'actionable' as const,
    confidence: 0.95,
    reasoning: 'User requested code changes',
    requestedWorkerType: 'opus' as const,
    decision: { kind: 'create_pr_comment_task' as const },
  };

  it('accepts valid planner decision', () => {
    const result = WebhookAgentDecisionSchema.safeParse(validDecision);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1.0');
      expect(result.data.confidence).toBe(0.95);
      expect(result.data.decision.kind).toBe('create_pr_comment_task');
    }
  });

  it('accepts null requestedWorkerType', () => {
    const result = WebhookAgentDecisionSchema.safeParse({
      ...validDecision,
      requestedWorkerType: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestedWorkerType).toBeNull();
    }
  });

  it('rejects unknown top-level field (strict mode)', () => {
    const result = WebhookAgentDecisionSchema.safeParse({
      ...validDecision,
      hallucinated_field: 'surprise',
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence below 0', () => {
    const result = WebhookAgentDecisionSchema.safeParse({
      ...validDecision,
      confidence: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence above 1', () => {
    const result = WebhookAgentDecisionSchema.safeParse({
      ...validDecision,
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid decision kind', () => {
    const result = WebhookAgentDecisionSchema.safeParse({
      ...validDecision,
      decision: { kind: 'deploy_to_production' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid eventGroup', () => {
    const result = WebhookAgentDecisionSchema.safeParse({
      ...validDecision,
      eventGroup: 'deployment',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing version', () => {
    const { version: _, ...noVersion } = validDecision;
    const result = WebhookAgentDecisionSchema.safeParse(noVersion);
    expect(result.success).toBe(false);
  });

  it('rejects wrong version value', () => {
    const result = WebhookAgentDecisionSchema.safeParse({
      ...validDecision,
      version: '2.0',
    });
    expect(result.success).toBe(false);
  });
});

describe('WebhookActionPlanSchema', () => {
  const validPlan = {
    version: '1.0' as const,
    decisionKind: 'create_pr_comment_task' as const,
    actions: [
      {
        actionId: 'act-001',
        type: 'dispatch_task' as const,
        params: { prompt: 'Fix the bug' },
      },
      {
        actionId: 'act-002',
        type: 'notify_chat' as const,
        params: { message: 'Task dispatched' },
      },
    ],
  };

  it('accepts valid action plan', () => {
    const result = WebhookActionPlanSchema.safeParse(validPlan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actions).toHaveLength(2);
      expect(result.data.actions[0]?.actionId).toBe('act-001');
    }
  });

  it('rejects plan without version', () => {
    const { version: _, ...noVersion } = validPlan;
    const result = WebhookActionPlanSchema.safeParse(noVersion);
    expect(result.success).toBe(false);
  });

  it('rejects action without actionId', () => {
    const result = WebhookActionPlanSchema.safeParse({
      ...validPlan,
      actions: [{ type: 'dispatch_task', params: {} }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown top-level field (strict mode)', () => {
    const result = WebhookActionPlanSchema.safeParse({
      ...validPlan,
      extra_field: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty actions array', () => {
    const result = WebhookActionPlanSchema.safeParse({
      ...validPlan,
      actions: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action type', () => {
    const result = WebhookActionPlanSchema.safeParse({
      ...validPlan,
      actions: [{ actionId: 'a1', type: 'launch_missiles', params: {} }],
    });
    expect(result.success).toBe(false);
  });
});

describe('WebhookActionStepResultSchema', () => {
  it('accepts successful step result', () => {
    const result = WebhookActionStepResultSchema.safeParse({
      actionId: 'act-001',
      status: 'success',
      durationMs: 120,
    });
    expect(result.success).toBe(true);
  });

  it('accepts failed step result with error', () => {
    const result = WebhookActionStepResultSchema.safeParse({
      actionId: 'act-002',
      status: 'failed',
      durationMs: 50,
      error: 'Connection refused',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error).toBe('Connection refused');
    }
  });

  it('accepts skipped step result', () => {
    const result = WebhookActionStepResultSchema.safeParse({
      actionId: 'act-003',
      status: 'skipped',
      durationMs: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing actionId', () => {
    const result = WebhookActionStepResultSchema.safeParse({
      status: 'success',
      durationMs: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe('WebhookAgentRunRecordSchema', () => {
  const validRecord = {
    runId: 'run-abc-123',
    savedEventId: 'evt-456',
    eventGroup: 'comment' as const,
    startedAt: '2026-02-27T10:00:00Z',
    completedAt: '2026-02-27T10:00:05Z',
    durationMs: 5000,
    decision: {
      version: '1.0' as const,
      eventGroup: 'comment' as const,
      actionability: 'actionable' as const,
      confidence: 0.9,
      reasoning: 'Code change request',
      requestedWorkerType: null,
      decision: { kind: 'send_task_message' as const },
    },
    actionPlan: {
      version: '1.0' as const,
      decisionKind: 'send_task_message' as const,
      actions: [],
    },
    stepResults: [],
    outcome: 'completed' as const,
  };

  it('accepts valid run record', () => {
    const result = WebhookAgentRunRecordSchema.safeParse(validRecord);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runId).toBe('run-abc-123');
      expect(result.data.savedEventId).toBe('evt-456');
    }
  });

  it('rejects missing runId', () => {
    const { runId: _, ...noRunId } = validRecord;
    const result = WebhookAgentRunRecordSchema.safeParse(noRunId);
    expect(result.success).toBe(false);
  });

  it('rejects missing savedEventId', () => {
    const { savedEventId: _, ...noEventId } = validRecord;
    const result = WebhookAgentRunRecordSchema.safeParse(noEventId);
    expect(result.success).toBe(false);
  });

  it('accepts run record with failed outcome and error', () => {
    const result = WebhookAgentRunRecordSchema.safeParse({
      ...validRecord,
      outcome: 'failed',
      error: 'Planner returned invalid JSON',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outcome).toBe('failed');
      expect(result.data.error).toBe('Planner returned invalid JSON');
    }
  });

  it('accepts run record with noop outcome', () => {
    const result = WebhookAgentRunRecordSchema.safeParse({
      ...validRecord,
      outcome: 'noop',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid outcome value', () => {
    const result = WebhookAgentRunRecordSchema.safeParse({
      ...validRecord,
      outcome: 'maybe',
    });
    expect(result.success).toBe(false);
  });
});
