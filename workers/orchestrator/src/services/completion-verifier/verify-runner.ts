import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { stripDockerHeaders } from '../log-formatter.js';
import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';
import {
  getSchemaForAgent,
  toAgentData,
  RESUME_SUMMARY_SCHEMA,
  type CompletionAgentType,
  type PlanningAgentData,
  type ExecutionAgentData,
  type PullRequestAgentData,
  type ReviewAgentData,
  type RemediationAgentData,
} from './schemas.js';
import { buildVerificationPrompt, buildResumeSummaryPrompt } from './prompt-builder.js';
import {
  callVerificationLlm,
  extractAndParseJson,
  generateResumeSummaryWithFallback,
} from './llm-client.js';
import {
  detectEmptyMemoryFields,
  validateMemoryReporting,
  type MemoryReportingValidationResult,
} from './memory-validation.js';

export interface VerifyRunnerVerdict {
  passed: boolean;
  missingFields: string[];
  verifierFailure: boolean;
  agentData?:
    | PlanningAgentData
    | ExecutionAgentData
    | PullRequestAgentData
    | ReviewAgentData
    | RemediationAgentData;
  succeededModelName?: string;
  trace: { transcript: string; prompt: string; response: string };
}

export interface VerifyRunnerInput {
  taskId: string;
  attempt: number;
  maxAttempts: number;
  agentType: CompletionAgentType;
  rawLogs: string;
  lastExitCode?: number;
  executionMemoryContext?: ExecutionMemoryPromptContext;
}

export interface VerifyRunnerDeps {
  logger: Logger;
  primaryClient: LlmGenerateClient;
  primaryModelName: string;
  fallbacks: readonly { client: LlmGenerateClient; modelName: string }[];
}

const FATAL_EXIT_CODE_PATTERN =
  /\[entrypoint\] (?:Claude|Codex) attempt finished with exit code: (137|139)/;

const MIN_MEANINGFUL_TRANSCRIPT_LINES = 5;

const INFRASTRUCTURE_LINE_PREFIXES = ['[orchestrator]', '[hook]', '[entrypoint]', '[system]'];

export function countMeaningfulTranscriptLines(nonEmptyLines: readonly string[]): number {
  let count = 0;
  for (const line of nonEmptyLines) {
    const trimmed = line.trim();
    if (INFRASTRUCTURE_LINE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
      continue;
    }
    count += 1;
  }
  return count;
}

export function detectFatalExitCode(rawLogs: string): number | undefined {
  // Only search the last 5 lines to avoid false positives from Claude's
  // stream-json output containing test fixtures or code snippets with the pattern.
  // The actual [entrypoint] exit line is always near the end of raw logs.
  const tail = rawLogs.split('\n').slice(-5).join('\n');
  const match = FATAL_EXIT_CODE_PATTERN.exec(tail);
  if (match?.[1] !== undefined) {
    return Number(match[1]);
  }
  return undefined;
}

export function getLast50Lines(rawLogs: string): string {
  return stripDockerHeaders(rawLogs).split('\n').slice(-50).join('\n');
}

export function getLast50ClaudeLines(rawLogs: string): string {
  const lines = stripDockerHeaders(rawLogs).split('\n');
  const claudeLines = lines.filter((line) => line.startsWith('[claude]'));
  return claudeLines.slice(-50).join('\n');
}

export function getLast20Lines(rawLogs: string): string {
  return stripDockerHeaders(rawLogs).split('\n').slice(-20).join('\n');
}

export async function runVerify(
  deps: VerifyRunnerDeps,
  input: VerifyRunnerInput
): Promise<VerifyRunnerVerdict> {
  const { logger, primaryClient, primaryModelName, fallbacks } = deps;
  const transcript = getLast50Lines(input.rawLogs);

  const directExitCode =
    input.lastExitCode === 137 || input.lastExitCode === 139 ? input.lastExitCode : undefined;
  const fatalExitCode = directExitCode ?? detectFatalExitCode(input.rawLogs);
  if (fatalExitCode !== undefined) {
    logger.warn(
      {
        taskId: input.taskId,
        attempt: input.attempt,
        agentType: input.agentType,
        exitCode: fatalExitCode,
        source: directExitCode !== undefined ? 'lastExitCode' : 'rawLogs',
      },
      'Fatal exit code detected — skipping completion verification'
    );
    return {
      passed: false,
      missingFields: [`fatal_exit_code_${String(fatalExitCode)}`],
      verifierFailure: false,
      trace: { transcript, prompt: '', response: '' },
    };
  }

  const tLines = transcript.split('\n').filter((l) => l.trim() !== '');
  const meaningfulLines = countMeaningfulTranscriptLines(tLines);
  if (meaningfulLines < MIN_MEANINGFUL_TRANSCRIPT_LINES) {
    logger.warn(
      {
        taskId: input.taskId,
        attempt: input.attempt,
        agentType: input.agentType,
        meaningfulLines,
      },
      'Completion verifier: transcript too short, refusing to call LLM'
    );
    return {
      passed: false,
      missingFields: ['transcript_too_short'],
      verifierFailure: false,
      trace: { transcript, prompt: '', response: '' },
    };
  }

  const schema = getSchemaForAgent(input.agentType);
  const prompt = buildVerificationPrompt(input.agentType, transcript);

  logger.info(
    {
      taskId: input.taskId,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      agentType: input.agentType,
      model: primaryModelName,
      promptChars: prompt.length,
      transcript: ((): string => {
        /* v8 ignore start -- ts-type: nullish coalescing on array access required by noUncheckedIndexedAccess; transcript guard guarantees tLines.length >= MIN_MEANINGFUL_TRANSCRIPT_LINES @preserve */
        const first = tLines[0] ?? '';
        const last = tLines[tLines.length - 1] ?? '';
        /* v8 ignore stop @preserve */
        return `${first}\n  ... (${String(tLines.length - 2)} lines omitted) ...\n${last}`;
      })(),
    },
    'Completion verifier request'
  );

  const allModels: { client: LlmGenerateClient; modelName: string }[] = [
    { client: primaryClient, modelName: primaryModelName },
    ...fallbacks,
  ];

  const llmResult = await callVerificationLlm({
    models: allModels,
    prompt,
    schema,
    logger,
    taskId: input.taskId,
    attempt: input.attempt,
  });

  if (!llmResult.ok) {
    if (llmResult.error.kind === 'schema-failed') {
      logger.error(
        {
          taskId: input.taskId,
          attempt: input.attempt,
          model: llmResult.error.modelName,
          missingFields: llmResult.error.missingFields,
        },
        'Completion verifier: all models failed schema validation'
      );
      return {
        passed: false,
        missingFields: llmResult.error.missingFields,
        verifierFailure: false,
        succeededModelName: llmResult.error.modelName,
        trace: { transcript, prompt, response: llmResult.error.content },
      };
    }
    logger.error(
      { taskId: input.taskId, attempt: input.attempt },
      'Completion verifier returned no response (all models failed)'
    );
    return {
      passed: false,
      missingFields: [],
      verifierFailure: true,
      trace: { transcript, prompt, response: llmResult.error.content },
    };
  }

  // @allow-result-access -- guarded by if (!llmResult.ok) early return above
  const { content: lastGeneratedContent, modelName: succeededModelName, parsed } = llmResult.value;

  const emptyMemoryFields = detectEmptyMemoryFields(
    input.agentType,
    input.executionMemoryContext,
    parsed
  );
  if (emptyMemoryFields !== undefined) {
    logger.warn(
      {
        taskId: input.taskId,
        attempt: input.attempt,
        model: succeededModelName,
        emptyMemoryFields,
      },
      'Memory fields are empty despite memories being injected'
    );
    return {
      passed: false,
      missingFields: emptyMemoryFields,
      verifierFailure: false,
      succeededModelName,
      trace: { transcript, prompt, response: lastGeneratedContent },
    };
  }

  const agentData = toAgentData(input.agentType, parsed);
  const memoryValidation: MemoryReportingValidationResult =
    input.executionMemoryContext !== undefined
      ? validateMemoryReporting(input.rawLogs, input.executionMemoryContext, agentData)
      : { failures: [], softWarnings: [] };

  if (memoryValidation.softWarnings.length > 0) {
    logger.warn(
      {
        taskId: input.taskId,
        attempt: input.attempt,
        model: succeededModelName,
        softWarnings: memoryValidation.softWarnings,
      },
      'Completion verifier memory validation soft warning: triplet consistent, block missing'
    );
  }

  if (memoryValidation.failures.length > 0) {
    logger.warn(
      {
        taskId: input.taskId,
        attempt: input.attempt,
        model: succeededModelName,
        memoryValidationFailures: memoryValidation.failures,
      },
      'Completion verifier memory validation failed'
    );
    return {
      passed: false,
      missingFields: memoryValidation.failures,
      verifierFailure: false,
      succeededModelName,
      trace: { transcript, prompt, response: lastGeneratedContent },
    };
  }

  logger.info(
    {
      taskId: input.taskId,
      attempt: input.attempt,
      model: succeededModelName,
      agentData,
    },
    'Completion verifier parsed verdict'
  );

  return {
    passed: true,
    missingFields: [],
    verifierFailure: false,
    agentData,
    succeededModelName,
    trace: { transcript, prompt, response: lastGeneratedContent },
  };
}

export async function runExtractResumeSummary(
  deps: VerifyRunnerDeps,
  taskId: string,
  rawLogs: string
): Promise<string | undefined> {
  const { logger, primaryClient, primaryModelName, fallbacks } = deps;
  const transcript = getLast20Lines(rawLogs);
  const prompt = buildResumeSummaryPrompt(transcript);

  const generated = await generateResumeSummaryWithFallback({
    primaryClient,
    primaryModelName,
    fallbacks,
    prompt,
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

  const resumeContent = generated.value.content; // @allow-result-access -- guarded by if (!generated.ok) early return above
  let rawJson: unknown;
  try {
    rawJson = extractAndParseJson(resumeContent);
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
  logger.info({ taskId, summaryLength: summary.length }, 'extractResumeSummary: summary extracted');
  return summary;
}
