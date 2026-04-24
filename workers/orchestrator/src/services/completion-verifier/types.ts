import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';
import type {
  CompletionAgentType,
  PlanningAgentData,
  ExecutionAgentData,
  PullRequestAgentData,
  ReviewAgentData,
  RemediationAgentData,
} from './schemas.js';

export interface CompletionVerifierInput {
  taskId: string;
  attempt: number;
  maxAttempts: number;
  agentType: CompletionAgentType;
  rawLogs: string;
  /** Exit code of the worker process if known. 137/139 short-circuits without LLM. */
  lastExitCode?: number;
  executionMemoryContext?: ExecutionMemoryPromptContext;
}

export interface CompletionVerifierTrace {
  transcript: string;
  prompt: string;
  response: string;
}

export interface CompletionVerifierVerdict {
  /** True when LLM extraction succeeded and all Zod fields were present — does NOT mean the agent completed its task. */
  passed: boolean;
  /** Blocking fields — deliverable contract (e.g. gh_pr_url, review_comments_posted). Non-empty → task cannot succeed regardless of worker tier. */
  missingFields: string[];
  /** Telemetry fields — memory acknowledgment / reporting. Non-empty → task may still succeed when worker tier is 'optional'. */
  telemetryMissingFields: string[];
  verifierFailure: boolean;
  agentData?:
    | PlanningAgentData
    | ExecutionAgentData
    | PullRequestAgentData
    | ReviewAgentData
    | RemediationAgentData;
  /** Model name that produced the response. Undefined when no model produced content. */
  succeededModelName?: string;
  trace: CompletionVerifierTrace;
}

export interface CompletionVerifier {
  verify(input: CompletionVerifierInput): Promise<CompletionVerifierVerdict>;
  describe(): { enabled: boolean; provider?: string; model?: string };
  extractResumeSummary(taskId: string, rawLogs: string): Promise<string | undefined>;
}

export interface CompletionVerifierClients {
  primaryClient: LlmGenerateClient;
  fallbackClients: LlmGenerateClient[];
  /** Display name of primary model for logging (e.g. 'or:google/gemma-4-31b-it:free') */
  primaryModelName: string;
  /** Display names for each fallback client, in order. Missing entries default to 'fallback-<n>'. */
  fallbackModelNames?: string[];
}
