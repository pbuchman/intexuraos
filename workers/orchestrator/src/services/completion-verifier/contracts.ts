import type { CompletionAgentType } from './schemas.js';
import type { WorkerType } from '../isolation/types.js';

/** A field in an AGENT_FINAL block. */
export interface FieldSpec {
  /** Canonical field name (agent emits this AND parser reads this). */
  name: string;
  /** Legacy names still accepted during dual-read migration windows. */
  alias?: readonly string[];
  /** How to coerce the raw string value. */
  kind: 'string' | 'url' | 'int' | 'bool01' | 'csv' | 'enum';
  /**
   * Required = part of the deliverable contract. Missing required fields on a
   * tier=required worker produce a hard verification failure. Missing required
   * fields on a tier=optional worker still complete as `accept` with warnings.
   */
  required: boolean;
  /** For kind='enum'. Case-insensitive match. */
  enumValues?: readonly string[];
  /** Values treated as "empty". Default: ['', 'none', 'None', 'N/A', 'n/a']. */
  emptyAliases?: readonly string[];
}

export interface AgentContract {
  /** Literal header line the agent emits, including the trailing colon. */
  marker: string;
  /** Field list in canonical order. */
  fields: readonly FieldSpec[];
}

const DEFAULT_EMPTY_ALIASES = ['', 'none', 'None', 'N/A', 'n/a'] as const;

const MEMORY_FIELDS_STANDARD: readonly FieldSpec[] = [
  { name: 'memory_ids_used', kind: 'csv', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
  {
    name: 'memory_ids_rejected',
    kind: 'csv',
    required: false,
    emptyAliases: DEFAULT_EMPTY_ALIASES,
  },
  {
    name: 'memory_usage_summary',
    kind: 'string',
    required: false,
    emptyAliases: DEFAULT_EMPTY_ALIASES,
  },
];

const MEMORY_FIELDS_EXECUTION: readonly FieldSpec[] = [
  {
    name: 'memory_ids_used',
    alias: ['execution_memory_ids_used'],
    kind: 'csv',
    required: false,
    emptyAliases: DEFAULT_EMPTY_ALIASES,
  },
  {
    name: 'memory_ids_rejected',
    alias: ['execution_memory_ids_rejected'],
    kind: 'csv',
    required: false,
    emptyAliases: DEFAULT_EMPTY_ALIASES,
  },
  {
    name: 'memory_usage_summary',
    alias: ['execution_memory_usage_summary'],
    kind: 'string',
    required: false,
    emptyAliases: DEFAULT_EMPTY_ALIASES,
  },
];

export const AGENT_CONTRACTS: Record<CompletionAgentType, AgentContract> = {
  planning: {
    marker: 'PLANNING_AGENT_FINAL:',
    fields: [
      {
        name: 'outcome',
        alias: ['Outcome'],
        kind: 'enum',
        required: true,
        enumValues: ['planned', 'unclear'],
      },
      {
        name: 'superpowers_writing_plans_used',
        kind: 'bool01',
        required: true,
      },
      { name: 'linear_issue', alias: ['Linear issue'], kind: 'url', required: true },
      { name: 'complex_task', alias: ['Complex task'], kind: 'bool01', required: true },
      { name: 'plan_doc', alias: ['Plan doc'], kind: 'bool01', required: true },
      // `subtask_urls` is conditionally required: empty is valid per the prompt
      // text "comma-separated full Linear URLs, or empty". Most non-complex
      // planning tasks emit empty. Keeping this `required: true` would fail every
      // simple/plan-doc planning task. Treat as optional with empty-alias coercion.
      {
        name: 'subtask_urls',
        alias: ['Subtask URLs'],
        kind: 'csv',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      {
        name: 'plan_pr',
        alias: ['Plan PR'],
        kind: 'url',
        required: true,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      // `parallel_breakdown_proof` is required only when Complex task=1; the live
      // prompt says "empty otherwise". Enforcing required: true would reject
      // every simple/plan-doc planning fixture in prod.
      {
        name: 'parallel_breakdown_proof',
        alias: ['Parallel breakdown proof'],
        kind: 'string',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      ...MEMORY_FIELDS_STANDARD,
      // `clarification_message` is required ONLY for unclear outcomes; the live
      // prompt says "MUST be empty for successfully planned outcomes". Hard-gating
      // would fail every planned outcome.
      {
        name: 'clarification_message',
        alias: ['Clarification message'],
        kind: 'string',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      { name: 'summary', alias: ['Summary'], kind: 'string', required: true },
    ],
  },
  execution: {
    marker: 'EXECUTION_AGENT_FINAL:',
    fields: [
      {
        name: 'outcome',
        alias: ['Outcome'],
        kind: 'enum',
        required: true,
        enumValues: ['implemented', 'already_completed', 'failed'],
      },
      {
        name: 'pr',
        alias: ['PR', 'gh_pr_url'],
        kind: 'url',
        required: true,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      {
        name: 'ci_evidence',
        alias: ['CI evidence'],
        kind: 'string',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      {
        name: 'linear_issue',
        alias: ['Linear issue'],
        kind: 'url',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      { name: 'review_iterations', alias: ['Review iterations'], kind: 'int', required: false },
      ...MEMORY_FIELDS_EXECUTION,
      { name: 'superpowers_subagent_driven_dev_used', kind: 'bool01', required: false },
      { name: 'superpowers_requesting_code_review_used', kind: 'bool01', required: false },
      { name: 'trivial_task', kind: 'bool01', required: false },
      { name: 'subagents', kind: 'string', required: false, emptyAliases: DEFAULT_EMPTY_ALIASES },
      {
        name: 'skill_sequence_proof',
        alias: ['Skill sequence proof'],
        kind: 'string',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      {
        // [INT-1470] Emitted by the execution prompt when outcome=failed; "n/a"
        // otherwise. Consumers downstream (task-dispatcher, metrics, compliance)
        // read `data.failure_reason` to label runtime hard errors.
        name: 'failure_reason',
        kind: 'string',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      { name: 'summary', alias: ['Summary'], kind: 'string', required: true },
    ],
  },
  review: {
    marker: 'REVIEW_AGENT_FINAL:',
    fields: [
      { name: 'pr', alias: ['PR', 'gh_pr_url'], kind: 'url', required: true },
      { name: 'review_id', kind: 'string', required: true },
      { name: 'review_comments_posted', kind: 'int', required: false },
      {
        name: 'review_types',
        kind: 'csv',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      {
        name: 'requirements_tracker_updated',
        kind: 'string',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      {
        name: 'gh_actions_status',
        kind: 'string',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      { name: 'needs_remediation', kind: 'bool01', required: false },
      ...MEMORY_FIELDS_STANDARD,
      { name: 'summary', alias: ['Summary'], kind: 'string', required: true },
    ],
  },
  remediation: {
    marker: 'REMEDIATION_AGENT_FINAL:',
    fields: [
      {
        name: 'outcome',
        alias: ['Outcome'],
        kind: 'enum',
        required: true,
        enumValues: ['implemented', 'already_completed'],
      },
      { name: 'pr', alias: ['PR', 'gh_pr_url'], kind: 'url', required: true },
      { name: 'requires_re_review', kind: 'bool01', required: true },
      ...MEMORY_FIELDS_STANDARD,
      { name: 'summary', alias: ['Summary'], kind: 'string', required: true },
    ],
  },
  pull_request: {
    marker: 'PULL_REQUEST_AGENT_FINAL:',
    fields: [
      { name: 'pr', alias: ['PR', 'gh_pr_url'], kind: 'url', required: true },
      { name: 'ci_evidence', alias: ['CI evidence'], kind: 'string', required: true },
      {
        name: 'linear_issue',
        alias: ['Linear issue'],
        kind: 'url',
        required: false,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      {
        name: 'comment_replied',
        alias: ['Comment replied'],
        kind: 'enum',
        required: true,
        enumValues: ['yes', 'no'],
      },
      {
        name: 'tracking_comment_id',
        alias: ['Tracking comment ID'],
        kind: 'string',
        required: true,
        emptyAliases: DEFAULT_EMPTY_ALIASES,
      },
      {
        name: 'tracking_comment',
        alias: ['Tracking comment'],
        kind: 'string',
        required: true,
      },
      {
        name: 'total_pr_comments_posted',
        alias: ['Total PR comments posted'],
        kind: 'int',
        required: true,
      },
      ...MEMORY_FIELDS_STANDARD,
      { name: 'summary', alias: ['Summary'], kind: 'string', required: true },
    ],
  },
  ask_agent: {
    // ask_agent does not emit an AGENT_FINAL block; kept for type exhaustiveness.
    marker: '',
    fields: [],
  },
};

export type TelemetryExpectation = 'required' | 'optional';

export const TIER_BY_WORKER: Record<WorkerType, TelemetryExpectation> = {
  opus: 'required',
  sonnet: 'required',
  auto: 'required',
  glm: 'optional',
  minimax: 'optional',
  codex: 'optional',
  'codex-xhigh': 'optional',
  kimi: 'optional',
  qwen: 'optional',
  'mimo-pro': 'optional',
  'openrouter-free': 'optional',
};
