import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { ExecutionMemoryPromptContext } from '../types/execution-memory.js';
import type {
  CompletionAgentType,
  PlanningAgentData,
  ExecutionAgentData,
  PullRequestAgentData,
  ReviewAgentData,
  RemediationAgentData,
} from './completion-verifier/schemas.js';
import {
  runVerify,
  runExtractResumeSummary,
  countMeaningfulTranscriptLines,
  detectFatalExitCode,
  getLast50Lines,
  getLast50ClaudeLines,
  getLast20Lines,
} from './completion-verifier/verify-runner.js';

export {
  countMeaningfulTranscriptLines,
  detectFatalExitCode,
  getLast50Lines,
  getLast50ClaudeLines,
  getLast20Lines,
};
export { buildMemoryAcknowledgmentPattern } from './completion-verifier/memory-validation.js';
export {
  PLANNING_SCHEMA,
  EXECUTION_SCHEMA,
  PULL_REQUEST_SCHEMA,
  REVIEW_SCHEMA,
  REMEDIATION_SCHEMA,
  RESUME_SUMMARY_SCHEMA,
} from './completion-verifier/schemas.js';
export type {
  CompletionAgentType,
  PlanningAgentData,
  ExecutionAgentData,
  PullRequestAgentData,
  ReviewAgentData,
  RemediationAgentData,
} from './completion-verifier/schemas.js';
export {
  buildPlanningPrompt,
  buildExecutionPrompt,
  buildPullRequestPrompt,
  buildReviewPrompt,
  buildRemediationPrompt,
  buildResumeSummaryPrompt,
} from './completion-verifier/prompt-builder.js';

const verifierTaskIdStorage = new AsyncLocalStorage<string>();

/** Returns the task ID active in the current verifier async context, or null. */
export function getVerifierTaskId(): string | null {
  return verifierTaskIdStorage.getStore() ?? null;
}

export interface CompletionVerifierInput {
  taskId: string;
  attempt: number;
  maxAttempts: number;
  agentType: CompletionAgentType;
  rawLogs: string;
  /** Exit code of the worker process if known (Docker exit code). When set to
   *  137 (SIGKILL) or 139 (SIGSEGV), verification short-circuits without
   *  calling any LLM — used to catch cases where the entrypoint was killed
   *  externally and never wrote its own exit-code line. */
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
  missingFields: string[];
  verifierFailure: boolean;
  agentData?:
    | PlanningAgentData
    | ExecutionAgentData
    | PullRequestAgentData
    | ReviewAgentData
    | RemediationAgentData;
  /** Model name that produced the response. Undefined when no model produced
   *  content (all generate() calls failed) or when the short-circuit on
   *  fatal exit codes fires before any model is called. */
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
  /** Display names for each fallback client, in the same order as fallbackClients.
   *  If omitted or shorter than fallbackClients, missing entries default to 'fallback-1', 'fallback-2', etc. */
  fallbackModelNames?: string[];
}

export class OrchestratorCompletionVerifier implements CompletionVerifier {
  private readonly primaryClient: LlmGenerateClient;
  private readonly primaryModelName: string;
  /** Each fallback client paired with its display model name. */
  private readonly fallbacks: readonly { client: LlmGenerateClient; modelName: string }[];

  constructor(
    private readonly logger: Logger,
    clients: CompletionVerifierClients
  ) {
    this.primaryClient = clients.primaryClient;
    this.primaryModelName = clients.primaryModelName;
    const fallbackNames = clients.fallbackModelNames ?? [];
    this.fallbacks = clients.fallbackClients.map((client, i) => ({
      client,
      modelName: fallbackNames[i] ?? `fallback-${String(i + 1)}`,
    }));
  }

  describe(): { enabled: boolean; provider?: string; model?: string } {
    return { enabled: true, model: this.primaryModelName };
  }

  async verify(input: CompletionVerifierInput): Promise<CompletionVerifierVerdict> {
    return await verifierTaskIdStorage.run(input.taskId, () =>
      runVerify(
        {
          logger: this.logger,
          primaryClient: this.primaryClient,
          primaryModelName: this.primaryModelName,
          fallbacks: this.fallbacks,
        },
        input
      )
    );
  }

  async extractResumeSummary(taskId: string, rawLogs: string): Promise<string | undefined> {
    return await verifierTaskIdStorage.run(taskId, () =>
      runExtractResumeSummary(
        {
          logger: this.logger,
          primaryClient: this.primaryClient,
          primaryModelName: this.primaryModelName,
          fallbacks: this.fallbacks,
        },
        taskId,
        rawLogs
      )
    );
  }
}
