import { AsyncLocalStorage } from 'node:async_hooks';
import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
// prettier-ignore
import { getSchemaForAgent, toAgentData, RESUME_SUMMARY_SCHEMA } from './completion-verifier/schemas.js';
// prettier-ignore
import { buildVerificationPrompt, buildResumeSummaryPrompt } from './completion-verifier/prompt-builder.js';
// prettier-ignore
import { callVerificationLlm, extractAndParseJson, generateResumeSummaryWithFallback } from './completion-verifier/llm-client.js';
// prettier-ignore
import { detectEmptyMemoryFields, validateMemoryReporting, partitionMissingFields } from './completion-verifier/memory-validation.js';
// prettier-ignore
import { MIN_MEANINGFUL_TRANSCRIPT_LINES, countMeaningfulTranscriptLines, detectFatalExitCode, getLast20Lines, getLast50Lines } from './completion-verifier/transcript.js';
// prettier-ignore
import type { CompletionVerifier, CompletionVerifierClients, CompletionVerifierInput, CompletionVerifierVerdict } from './completion-verifier/types.js';

export * from './completion-verifier/schemas.js';
export * from './completion-verifier/types.js';
export * from './completion-verifier/transcript.js';
export * from './completion-verifier/prompt-builder.js';
export {
  buildMemoryAcknowledgmentPattern,
  isTelemetryField,
  partitionMissingFields,
} from './completion-verifier/memory-validation.js';

const verifierTaskIdStorage = new AsyncLocalStorage<string>();

/** Returns the task ID active in the current verifier async context, or null. */
export function getVerifierTaskId(): string | null {
  return verifierTaskIdStorage.getStore() ?? null;
}

function failVerdict(
  missingFields: string[],
  trace: CompletionVerifierVerdict['trace'],
  opts: {
    model?: string;
    verifierFailure?: boolean;
    telemetryMissingFields?: string[];
    agentData?: CompletionVerifierVerdict['agentData'];
  } = {}
): CompletionVerifierVerdict {
  return {
    passed: false,
    missingFields,
    telemetryMissingFields: opts.telemetryMissingFields ?? [],
    verifierFailure: opts.verifierFailure ?? false,
    ...(opts.model !== undefined && { succeededModelName: opts.model }),
    ...(opts.agentData !== undefined && { agentData: opts.agentData }),
    trace,
  };
}

export class OrchestratorCompletionVerifier implements CompletionVerifier {
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

  async verify(input: CompletionVerifierInput): Promise<CompletionVerifierVerdict> {
    return await verifierTaskIdStorage.run(input.taskId, () => this.doVerify(input));
  }

  async extractResumeSummary(taskId: string, rawLogs: string): Promise<string | undefined> {
    return await verifierTaskIdStorage.run(taskId, () =>
      this.doExtractResumeSummary(taskId, rawLogs)
    );
  }

  private async doVerify(input: CompletionVerifierInput): Promise<CompletionVerifierVerdict> {
    const { logger } = this;
    const { taskId, attempt, agentType, rawLogs, executionMemoryContext } = input;
    const transcript = getLast50Lines(rawLogs);
    const emptyTrace = { transcript, prompt: '', response: '' };

    const directExit =
      input.lastExitCode === 137 || input.lastExitCode === 139 ? input.lastExitCode : undefined;
    const fatalExit = directExit ?? detectFatalExitCode(rawLogs);
    if (fatalExit !== undefined) {
      const source = directExit !== undefined ? 'lastExitCode' : 'rawLogs';
      // prettier-ignore
      logger.warn({ taskId, attempt, agentType, exitCode: fatalExit, source }, 'Fatal exit code detected — skipping completion verification');
      return failVerdict([`fatal_exit_code_${String(fatalExit)}`], emptyTrace);
    }

    const tLines = transcript.split('\n').filter((l) => l.trim() !== '');
    const meaningfulLines = countMeaningfulTranscriptLines(tLines);
    if (meaningfulLines < MIN_MEANINGFUL_TRANSCRIPT_LINES) {
      // prettier-ignore
      logger.warn({ taskId, attempt, agentType, meaningfulLines }, 'Completion verifier: transcript too short, refusing to call LLM');
      return failVerdict(['transcript_too_short'], emptyTrace);
    }

    const prompt = buildVerificationPrompt(agentType, transcript);
    /* v8 ignore start -- ts-type: nullish coalescing on array access required by noUncheckedIndexedAccess; transcript guard guarantees tLines.length >= MIN_MEANINGFUL_TRANSCRIPT_LINES @preserve */
    const first = tLines[0] ?? '';
    const last = tLines[tLines.length - 1] ?? '';
    /* v8 ignore stop @preserve */
    const transcriptSummary = `${first}\n  ... (${String(tLines.length - 2)} lines omitted) ...\n${last}`;
    // prettier-ignore
    logger.info({ taskId, attempt, maxAttempts: input.maxAttempts, agentType, model: this.primaryModelName, promptChars: prompt.length, transcript: transcriptSummary }, 'Completion verifier request');

    // prettier-ignore
    const llmResult = await callVerificationLlm({ models: [{ client: this.primaryClient, modelName: this.primaryModelName }, ...this.fallbacks], prompt, schema: getSchemaForAgent(agentType), logger, taskId, attempt });

    if (!llmResult.ok) {
      const trace = { transcript, prompt, response: llmResult.error.content };
      if (llmResult.error.kind === 'schema-failed') {
        const { modelName: model, missingFields } = llmResult.error;
        const parts = partitionMissingFields(missingFields);
        // prettier-ignore
        logger.error({ taskId, attempt, model, missingFields: parts.blocking, telemetryMissingFields: parts.telemetry }, 'Completion verifier: all models failed schema validation');
        return failVerdict(parts.blocking, trace, {
          model,
          telemetryMissingFields: parts.telemetry,
        });
      }
      // prettier-ignore
      logger.error({ taskId, attempt }, 'Completion verifier returned no response (all models failed)');
      return failVerdict([], trace, { verifierFailure: true });
    }

    const { content: response, modelName: model, parsed } = llmResult.value; // @allow-result-access -- guarded by if (!llmResult.ok) early return above
    const trace = { transcript, prompt, response };
    // [INT-1461] Compute agentData up-front so we can thread it through the memory-failure
    // return sites; decideCompletionOutcome needs agentData to accept tier=optional verdicts.
    const agentData = toAgentData(agentType, parsed);

    const emptyMemoryFields = detectEmptyMemoryFields(agentType, executionMemoryContext, parsed);
    if (emptyMemoryFields !== undefined) {
      // prettier-ignore
      logger.warn({ taskId, attempt, model, emptyMemoryFields }, 'Memory fields are empty despite memories being injected');
      return failVerdict([], trace, {
        model,
        telemetryMissingFields: emptyMemoryFields,
        agentData,
      });
    }

    const memoryValidation =
      executionMemoryContext !== undefined
        ? validateMemoryReporting(rawLogs, executionMemoryContext, agentData)
        : { failures: [], softWarnings: [] };
    if (memoryValidation.softWarnings.length > 0) {
      // prettier-ignore
      logger.warn({ taskId, attempt, model, softWarnings: memoryValidation.softWarnings }, 'Completion verifier memory validation soft warning: triplet consistent, block missing');
    }
    if (memoryValidation.failures.length > 0) {
      // prettier-ignore
      logger.warn({ taskId, attempt, model, memoryValidationFailures: memoryValidation.failures }, 'Completion verifier memory validation failed');
      return failVerdict([], trace, {
        model,
        telemetryMissingFields: memoryValidation.failures,
        agentData,
      });
    }

    logger.info({ taskId, attempt, model, agentData }, 'Completion verifier parsed verdict');
    // prettier-ignore
    return { passed: true, missingFields: [], telemetryMissingFields: [], verifierFailure: false, agentData, succeededModelName: model, trace };
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
      prompt: buildResumeSummaryPrompt(getLast20Lines(rawLogs)),
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
