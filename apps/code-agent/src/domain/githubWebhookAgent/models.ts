import { z } from 'zod';

export const WorkerTypeSchema = z.enum(['auto', 'opus', 'sonnet', 'minimax', 'glm']);
export type WorkerType = z.infer<typeof WorkerTypeSchema>;

export const WebhookEventGroupSchema = z.enum([
  'pull_request',
  'comment',
  'github_action_result',
  'other',
]);
export type WebhookEventGroup = z.infer<typeof WebhookEventGroupSchema>;

export const DecisionKindSchema = z.enum([
  'noop',
  'send_task_message',
  'create_pr_comment_task',
  'create_code_action',
]);
export type DecisionKind = z.infer<typeof DecisionKindSchema>;

export const ActionabilitySchema = z.enum([
  'actionable',
  'non_actionable',
  'uncertain',
]);
export type Actionability = z.infer<typeof ActionabilitySchema>;

export const WebhookAgentDecisionSchema = z
  .object({
    version: z.literal('1.0'),
    eventGroup: WebhookEventGroupSchema,
    actionability: ActionabilitySchema,
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    requestedWorkerType: WorkerTypeSchema.nullable(),
    decision: z.object({ kind: DecisionKindSchema }).strict(),
  })
  .strict();
export type WebhookAgentDecision = z.infer<typeof WebhookAgentDecisionSchema>;

export const ActionTypeSchema = z.enum([
  'dispatch_task',
  'send_task_message',
  'mark_processing',
  'notify_chat',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionStepSchema = z
  .object({
    actionId: z.string().min(1),
    type: ActionTypeSchema,
    params: z.record(z.unknown()),
  })
  .strict();
export type ActionStep = z.infer<typeof ActionStepSchema>;

export const WebhookActionPlanSchema = z
  .object({
    version: z.literal('1.0'),
    decisionKind: DecisionKindSchema,
    actions: z.array(ActionStepSchema),
  })
  .strict();
export type WebhookActionPlan = z.infer<typeof WebhookActionPlanSchema>;

export const StepResultStatusSchema = z.enum(['success', 'failed', 'skipped']);

export const WebhookActionStepResultSchema = z.object({
  actionId: z.string().min(1),
  status: StepResultStatusSchema,
  durationMs: z.number(),
  error: z.string().optional(),
});
export type WebhookActionStepResult = z.infer<typeof WebhookActionStepResultSchema>;

export const RunOutcomeSchema = z.enum(['completed', 'noop', 'failed']);

export const WebhookAgentRunRecordSchema = z.object({
  runId: z.string().min(1),
  savedEventId: z.string().min(1),
  eventGroup: WebhookEventGroupSchema,
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number(),
  decision: WebhookAgentDecisionSchema,
  actionPlan: WebhookActionPlanSchema,
  stepResults: z.array(WebhookActionStepResultSchema),
  outcome: RunOutcomeSchema,
  error: z.string().optional(),
});
export type WebhookAgentRunRecord = z.infer<typeof WebhookAgentRunRecordSchema>;
