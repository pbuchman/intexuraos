import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Timestamp } from '@google-cloud/firestore';
import { IntexuraOSError } from '@intexuraos/common-core';
import type { PromptBuilder } from '@intexuraos/llm-prompts';
import type { CodeTask } from '../../models/codeTask.js';

export const DISTILLATION_VERSION = 'execution-memory-distiller@2.1.0';
export const PLANNING_DISTILLATION_VERSION = 'planning-memory-distiller@1.1.0';
export const REVIEW_DISTILLATION_VERSION = 'review-memory-distiller@1.1.0';
export const EVALUATION_VERSION = 'execution-memory-evaluator@2.0.0';
export const MAX_LOG_LINES = 350;
export const MAX_EVALUATION_LOG_LINES = 200;

export const EvaluationSchema = z.object({
  summary: z.string().min(1),
  perMemory: z.array(z.object({
    memoryIndex: z.number().int().min(1),
    outcome: z.enum(['positive', 'neutral', 'negative', 'unknown']),
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })).default([]),
});

export const DistillationSchema = z.object({
  decision: z.enum(['create', 'skip']),
  skipReason: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['infra_only', 'insufficient_signal', 'already_completed', 'no_reusable_lesson', 'planning_unclear']).optional()
  ),
  evidenceSummary: z.string().min(1),
  memories: z.array(z.object({
    memoryType: z.enum([
      'implementation_pattern', 'verification_pattern', 'pitfall_pattern',
      'decomposition_pattern', 'planning_decision', 'review_finding',
    ]),
    title: z.string().min(1),
    appliesWhen: z.string().min(1),
    action: z.string().min(1),
    avoid: z.string().min(1),
    verification: z.string().min(1),
    evidenceSummary: z.string().min(1),
    retrievalText: z.string().min(1),
    keywords: z.array(z.string()).default([]),
    componentHints: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
  })).default([]),
});

export const DISTILLATION_SCHEMA_BLOCK = [
  'Return JSON only. Use this exact schema:',
  '{',
  '  "decision": "create" | "skip",',
  '  "skipReason": "infra_only" | "insufficient_signal" | "already_completed" | "no_reusable_lesson" | "planning_unclear",  // required when decision is "skip"',
  '  "evidenceSummary": "string (non-empty, summarize what happened)",',
  '  "memories": [  // empty array when decision is "skip"',
  '    {',
  '      "memoryType": "implementation_pattern" | "verification_pattern" | "pitfall_pattern" | "decomposition_pattern" | "planning_decision" | "review_finding",',
  '      "title": "string (short descriptive title)",',
  '      "appliesWhen": "string (when this memory should be applied)",',
  '      "action": "string (what to do)",',
  '      "avoid": "string (what to avoid)",',
  '      "verification": "string (how to verify correctness)",',
  '      "evidenceSummary": "string (evidence from this task)",',
  '      "retrievalText": "string (text used for semantic search matching)",',
  '      "keywords": ["string"],',
    '      "componentHints": ["string (canonical service/module names this applies to)"],',
  '      "confidence": 0.0 to 1.0',
  '    }',
  '  ]',
  '}',
  '',
  'componentHints guidance:',
  '- Use canonical service and module names from the codebase: code-agent, orchestrator, web-app,',
  '  task-router, auth, firestore, pubsub, linear, llm-factory, common-core, infra-firestore.',
  '- Use concise single-word or hyphenated identifiers, NOT multi-word phrases.',
  '- Include both the specific service (e.g. "code-agent") and the domain area (e.g. "testing",',
  '  "routing", "memory", "prompt", "ci", "migration", "schema").',
  '- Aim for 3-6 hints per memory. More hints = higher chance of matching future queries.',
  '- BAD: ["testing"] (too generic), ["code-agent service execution memory"] (too long).',
  '- GOOD: ["code-agent", "memory", "retrieval", "firestore", "testing"].',
  '',
  'Example (skip):',
  '{"decision":"skip","skipReason":"no_reusable_lesson","evidenceSummary":"Task was a trivial typo fix with no reusable pattern.","memories":[]}',
  '',
  'Example (create):',
  '{"decision":"create","evidenceSummary":"Discovered that route handlers need serialization tests.","memories":[{"memoryType":"verification_pattern","title":"Verify route serialization","appliesWhen":"Modifying route handlers","action":"Add app.inject tests for response shape","avoid":"Skipping serialization checks","verification":"Run route tests and check response schema","evidenceSummary":"Route handler returned wrong shape without test coverage","retrievalText":"route handler serialization verification test coverage","keywords":["route","serialization"],"componentHints":["code-agent","routing","testing","fastify"],"confidence":0.85}]}',
].join('\n');

export const EVALUATION_SCHEMA_BLOCK = [
  'Return JSON only. Use this exact schema:',
  '{',
  '  "summary": "string (non-empty, overall assessment of how matched memories helped this task)",',
  '  "perMemory": [',
  '    {',
  '      "memoryIndex": 1,  // integer index from [N] above',
  '      "outcome": "positive" | "neutral" | "negative" | "unknown",',
  '      "reason": "string (why this outcome)",',
  '      "confidence": 0.0 to 1.0',
  '    }',
  '  ]',
  '}',
  '',
  'Example (memories helped):',
  '{"summary":"The previous verification memory directly helped the fix.","perMemory":[{"memoryIndex":1,"outcome":"positive","reason":"The route coverage lesson was applied.","confidence":0.84}]}',
  '',
  'Example (no matched memories to evaluate):',
  '{"summary":"No matched memories were provided for this task.","perMemory":[]}',
].join('\n');

export function shouldSkipDistillation(task: CodeTask): {
  skip: boolean;
  reason?: 'already_completed' | 'planning_unclear';
} {
  if (task.result?.execution_outcome_label === 'already_completed') {
    return { skip: true, reason: 'already_completed' };
  }
  if (task.agentType === 'planning' && task.result?.planning_outcome_label === 'unclear') {
    return { skip: true, reason: 'planning_unclear' };
  }
  return { skip: false };
}

export function shouldSuppressMemory(
  applicationCount: number,
  negativeCount: number,
  qualityScore: number
): boolean {
  return (applicationCount >= 3 && negativeCount / applicationCount >= 0.5)
    || qualityScore < 0.25;
}

export function computeQualityScore(params: {
  applicationCount: number;
  positiveCount: number;
  confidence: number;
  lastAppliedAt?: Timestamp;
}): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const RECENCY_DECAY_DAYS = 180;
  const effectiveness = (params.positiveCount + 1) / (params.applicationCount + 2);
  const recency = params.lastAppliedAt !== undefined
    ? Math.max(0, Math.min(1, 1 - (Date.now() - params.lastAppliedAt.toDate().getTime()) / (RECENCY_DECAY_DAYS * MS_PER_DAY)))
    : 1;
  return (0.5 * effectiveness) + (0.3 * params.confidence) + (0.2 * recency);
}

export function parseCsv(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function parseJsonObject(response: string): unknown {
  const stripped = response.replace(/```(?:json)?\s*\n?([\s\S]*?)```/g, '$1');
  const match = /\{[\s\S]*\}/.exec(stripped);
  if (match === null) {
    throw new IntexuraOSError('INTERNAL_ERROR', 'Response did not contain JSON');
  }
  return JSON.parse(match[0]);
}

export function normalizeFingerprintText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function buildFingerprint(
  repository: string,
  memory: z.infer<typeof DistillationSchema>['memories'][number]
): string {
  return createHash('sha256')
    .update([
      repository,
      memory.memoryType,
      normalizeFingerprintText(memory.title),
      normalizeFingerprintText(memory.appliesWhen),
      normalizeFingerprintText(memory.action),
      normalizeFingerprintText(memory.avoid),
    ].join('::'))
    .digest('hex')
    .slice(0, 24);
}

export function isInfraOnlyFailure(task: CodeTask): boolean {
  const code = task.error?.code ?? '';
  return [
    'dispatch_failed',
    'worker_unavailable',
    'queue_timeout',
    'retry_exhausted',
    'retry_expired',
    'network_error',
  ].includes(code);
}

export function buildEvaluationContext(task: CodeTask): {
  selfReportUsed: string;
  selfReportRejected: string;
  selfReportSummary: string;
} {
  switch (task.agentType) {
    case 'planning':
      return {
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: task.result?.planning_outcome_label === 'planned'
          ? 'Planning completed successfully'
          : 'Planning outcome was unclear',
      };
    case 'review':
      return {
        selfReportUsed: '',
        selfReportRejected: '',
        selfReportSummary: task.result?.needs_remediation === '1'
          ? `Review found issues requiring remediation (${task.result.review_comments_posted ?? '0'} comments)`
          : 'Review completed with no remediation needed',
      };
    default:
      return {
        selfReportUsed: task.result?.execution_memory_ids_used ?? '',
        selfReportRejected: task.result?.execution_memory_ids_rejected ?? '',
        selfReportSummary: task.result?.execution_memory_usage_summary ?? '',
      };
  }
}

function renderExecutionDistillationPrompt(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] }
): string {
  return [
    `Version: ${DISTILLATION_VERSION}`,
    `Task status: ${task.status}`,
    `Task summary: ${task.result?.summary ?? ''}`,
    `Task error: ${task.error?.message ?? ''}`,
    `Linear description: ${issueContext.description ?? ''}`,
    `Linear comments: ${issueContext.comments.map((comment) => comment.body).join('\n')}`,
    `Recent logs:\n${logs.map((line) => line.text).join('\n')}`,
    `Turn metrics:\n${JSON.stringify(turnMetrics)}`,
    DISTILLATION_SCHEMA_BLOCK,
  ].join('\n\n');
}

function renderPlanningDistillationPrompt(
  task: CodeTask,
  logs: { text: string }[],
  turnMetrics: unknown[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] }
): string {
  const subtaskCount = (task.result?.planning_subtask_urls ?? '').split(',').filter((u) => u.trim() !== '').length;
  return [
    `Version: ${PLANNING_DISTILLATION_VERSION}`,
    `Task status: ${task.status}`,
    `Planning outcome: ${task.result?.planning_outcome_label ?? ''}`,
    `Complexity classification: ${task.result?.planning_is_complex === '1' ? 'COMPLEX' : 'SIMPLE_OR_PLAN_DOC'}`,
    `Subtask count: ${String(subtaskCount)}`,
    `Used writing-plans skill: ${task.result?.planning_superpowers_writing_plans_used ?? ''}`,
    `Planning PR URL: ${task.result?.planning_pr_url ?? ''}`,
    `Linear description: ${issueContext.description ?? ''}`,
    `Linear comments: ${issueContext.comments.map((comment) => comment.body).join('\n')}`,
    `Recent logs:\n${logs.slice(0, MAX_LOG_LINES).map((line) => line.text).join('\n')}`,
    `Turn metrics:\n${JSON.stringify(turnMetrics)}`,
    [
      'You are a planning memory distiller. Analyze this completed planning task and extract',
      'reusable patterns about how issues should be planned and decomposed.',
      '',
      'Focus on:',
      '1. DECOMPOSITION PATTERNS: How was the issue broken into subtasks? What service boundaries',
      '   were identified? What parallelization strategy was used? Were subtasks properly scoped',
      '   to single services/workers?',
      '2. PLANNING DECISIONS: What indicators led to the complexity classification? What made this',
      '   issue SIMPLE vs COMPLEX? What signals in the Linear issue description predicted the',
      '   outcome?',
      '3. Any verification or pitfall patterns that emerged during planning (e.g., missing',
      '   composite indexes, cross-service dependencies that blocked parallelization).',
      '',
      'Memory types to use:',
      '- "decomposition_pattern": How complex issues should be broken into subtasks',
      '- "planning_decision": Complexity classification heuristics and indicators',
      '- "implementation_pattern": Reusable if planning uncovered an implementation approach',
      '- "verification_pattern": Reusable if planning identified verification requirements',
      '- "pitfall_pattern": Reusable if planning identified risks or common mistakes',
    ].join('\n'),
    DISTILLATION_SCHEMA_BLOCK,
  ].join('\n\n');
}

function renderReviewDistillationPrompt(
  task: CodeTask,
  logs: { text: string }[],
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] }
): string {
  return [
    `Version: ${REVIEW_DISTILLATION_VERSION}`,
    `Task status: ${task.status}`,
    `Review types: ${task.result?.review_types ?? ''}`,
    `Comments posted: ${task.result?.review_comments_posted ?? ''}`,
    `Needs remediation: ${task.result?.needs_remediation ?? ''}`,
    `CI status: ${task.result?.gh_actions_status ?? ''}`,
    `Review body:\n${task.result?.review_body ?? ''}`,
    `Inline comments:\n${task.result?.review_inline_comments ?? ''}`,
    `Linear description: ${issueContext.description ?? ''}`,
    `Linear comments: ${issueContext.comments.map((comment) => comment.body).join('\n')}`,
    `Recent logs:\n${logs.slice(0, MAX_LOG_LINES).map((line) => line.text).join('\n')}`,
    [
      'You are a review memory distiller. Analyze this completed code review and extract',
      'reusable patterns that would help FUTURE EXECUTION AGENTS avoid the issues found.',
      '',
      'Focus on:',
      '1. REVIEW FINDINGS: What code quality, security, or architecture issues were flagged?',
      '   Are any of these recurring patterns that other execution tasks should know about?',
      '2. PITFALL PATTERNS: What mistakes did the implementation make that a review caught?',
      '   These are high-value memories — they prevent future agents from making the same errors.',
      '3. VERIFICATION PATTERNS: What checks or tests would have caught these issues before',
      '   review? These help execution agents self-verify before submitting for review.',
      '',
      'Memory types to use:',
      '- "review_finding": Recurring patterns flagged by reviewers that execution agents should be aware of',
      '- "pitfall_pattern": Specific mistakes the review caught that should be avoided',
      '- "verification_pattern": Tests or checks that would have caught the issues pre-review',
      '- "implementation_pattern": Better approaches the review suggested',
    ].join('\n'),
    DISTILLATION_SCHEMA_BLOCK,
  ].join('\n\n');
}

export interface DistillationPromptInput {
  task: CodeTask;
  logs: { text: string }[];
  turnMetrics: unknown[];
  issueContext: { description: string | null; comments: { body: string; createdAt: string }[] };
}

export const distillationPrompt: PromptBuilder<DistillationPromptInput> = {
  name: 'execution-memory-distillation',
  description:
    'Routes a completed code task to the appropriate distillation prompt (execution, planning, or review)',
  version: '1.0.0',

  build(input: DistillationPromptInput): string {
    const { task, logs, turnMetrics, issueContext } = input;
    switch (task.agentType) {
      case 'planning':
        return renderPlanningDistillationPrompt(task, logs, turnMetrics, issueContext);
      case 'review':
        return renderReviewDistillationPrompt(task, logs, issueContext);
      default:
        return renderExecutionDistillationPrompt(task, logs, turnMetrics, issueContext);
    }
  },
};
