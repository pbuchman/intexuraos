import { AsyncLocalStorage } from 'node:async_hooks';
import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  locateFinalBlock,
  parseKeyValues,
  coerceFields,
} from './completion-verifier/block-parser.js';
import { AGENT_CONTRACTS } from './completion-verifier/contracts.js';
import { detectEmptyMemoryFields } from './completion-verifier/memory-validation.js';
import { RESUME_SUMMARY_SCHEMA } from './completion-verifier/schemas.js';
import { resumeSummaryPrompt } from './completion-verifier/prompt-builder.js';
import {
  generateResumeSummaryWithFallback,
  extractAndParseJson,
} from './completion-verifier/llm-client.js';
import { getLast20Lines } from './completion-verifier/transcript.js';
import type {
  CompletionVerifierInput,
  CompletionVerifierVerdict,
} from './completion-verifier/types.js';

export * from './completion-verifier/contracts.js';
export * from './completion-verifier/schemas.js';
export * from './completion-verifier/types.js';
export * from './completion-verifier/transcript.js';
export {
  locateFinalBlock,
  parseKeyValues,
  coerceFields,
} from './completion-verifier/block-parser.js';
export {
  detectEmptyMemoryFields,
  isTelemetryField,
  partitionMissingFields,
  TELEMETRY_FIELD_NAMES,
} from './completion-verifier/memory-validation.js';
export { resumeSummaryPrompt } from './completion-verifier/prompt-builder.js';
export {
  generateResumeSummaryWithFallback,
  extractAndParseJson,
} from './completion-verifier/llm-client.js';

const verifierTaskIdStorage = new AsyncLocalStorage<string>();

/** Returns the task ID active in the current verifier async context, or null. */
export function getVerifierTaskId(): string | null {
  return verifierTaskIdStorage.getStore() ?? null;
}

/**
 * Deterministic completion verifier.
 *
 * 1. Fatal exit codes (137/139) → hard-error immediately.
 * 2. Locate the agent's AGENT_FINAL block. Absent → hard-error (routes to
 *    TASK_RUNTIME_HARD_ERROR upstream).
 * 3. Parse and coerce the block against the agent's contract.
 * 4. Check injected memories vs the agent's reported memory_ids_*.
 *
 * No network calls. No LLM. Returns synchronously.
 */
export function verifyCompletion(input: CompletionVerifierInput): CompletionVerifierVerdict {
  const { transcript, agentType, executionMemoryContext, lastExitCode } = input;

  if (lastExitCode === 137 || lastExitCode === 139) {
    return {
      kind: 'hard-error',
      code: 'TASK_RUNTIME_HARD_ERROR',
      message: `Fatal worker exit code: ${String(lastExitCode)}`,
    };
  }

  const contract = AGENT_CONTRACTS[agentType];
  if (contract.marker === '') {
    // ask_agent or other non-verifying agent — accept trivially.
    return {
      kind: 'parsed',
      data: {},
      missingRequired: [],
      telemetryMissing: [],
      warnings: [`agent ${agentType} has no contract — verification skipped`],
    };
  }

  const block = locateFinalBlock(transcript, contract.marker);
  if (block === null) {
    return {
      kind: 'hard-error',
      code: 'TASK_RUNTIME_HARD_ERROR',
      message: `No ${contract.marker} block in transcript`,
    };
  }

  const record = parseKeyValues(block);
  const { data, missingRequired, warnings } = coerceFields(record, contract);

  const telemetryMissing = detectEmptyMemoryFields(agentType, executionMemoryContext, data) ?? [];

  return {
    kind: 'parsed',
    data,
    missingRequired,
    telemetryMissing,
    warnings,
  };
}

/**
 * Injectable clients for the resume-summary LLM helper. Kept alongside
 * `ResumeSummaryExtractor` because the dispatcher wires them together at
 * bootstrap, and the helper is the only remaining LLM-backed code path in
 * the verifier module.
 */
export interface CompletionVerifierClients {
  primaryClient: LlmGenerateClient;
  fallbackClients: LlmGenerateClient[];
  /** Display name of primary model for logging. */
  primaryModelName: string;
  /** Display names for each fallback client, in order. */
  fallbackModelNames?: string[];
}

/**
 * Thin wrapper around the resume-summary LLM helper. Kept as a class so the
 * dispatcher can hold a single injectable reference; the verification path
 * itself is the sync `verifyCompletion` free function above and does NOT
 * go through this class.
 */
export class ResumeSummaryExtractor {
  private readonly primaryClient: LlmGenerateClient;
  private readonly primaryModelName: string;
  private readonly fallbacks: readonly { client: LlmGenerateClient; modelName: string }[];

  constructor(
    private readonly logger: Logger,
    clients: CompletionVerifierClients
  ) {
    this.primaryClient = clients.primaryClient;
    this.primaryModelName = clients.primaryModelName;
    const names = clients.fallbackModelNames ?? [];
    this.fallbacks = clients.fallbackClients.map((client, i) => ({
      client,
      modelName: names[i] ?? `fallback-${String(i + 1)}`,
    }));
  }

  describe(): { enabled: boolean; provider?: string; model?: string } {
    return { enabled: true, model: this.primaryModelName };
  }

  async extractResumeSummary(taskId: string, rawLogs: string): Promise<string | undefined> {
    return await verifierTaskIdStorage.run(taskId, () =>
      this.doExtractResumeSummary(taskId, rawLogs)
    );
  }

  private async doExtractResumeSummary(
    taskId: string,
    rawLogs: string
  ): Promise<string | undefined> {
    const { logger } = this;
    const generated = await generateResumeSummaryWithFallback({
      primaryClient: this.primaryClient,
      primaryModelName: this.primaryModelName,
      fallbacks: this.fallbacks,
      prompt: resumeSummaryPrompt.build({ transcript: getLast20Lines(rawLogs) }),
      taskId,
      logger,
    });
    if (!generated.ok) {
      logger.error(
        { taskId, errorCode: generated.error.code },
        'extractResumeSummary: LLM generate failed (all models)'
      );
      return undefined;
    }
    let rawJson: unknown;
    try {
      rawJson = extractAndParseJson(generated.value.content); // @allow-result-access -- guarded by if (!generated.ok) early return above
    } catch (error) {
      logger.error(
        { taskId, error: getErrorMessage(error) },
        'extractResumeSummary: JSON parse failed'
      );
      return undefined;
    }
    const parseResult = RESUME_SUMMARY_SCHEMA.safeParse(rawJson);
    if (!parseResult.success) {
      logger.error({ taskId }, 'extractResumeSummary: Zod validation failed');
      return undefined;
    }
    const { summary } = parseResult.data;
    logger.info(
      { taskId, summaryLength: summary.length },
      'extractResumeSummary: summary extracted'
    );
    return summary;
  }
}
