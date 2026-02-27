import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import { LlmModels, type LLMModel, type ModelPricing } from '@intexuraos/llm-contract';
import { StructuredLogUsageSink } from '@intexuraos/llm-pricing';
import { z } from 'zod';
import type { TaskResult } from '../types/task.js';
import { stripDockerHeaders } from './log-formatter.js';
import { OrchestratorFileAuditSink } from './orchestrator-audit-sink.js';

export type CompletionAgentType = 'planning' | 'execution' | 'pull_request';

export interface CompletionVerifierInput {
  taskId: string;
  attempt: number;
  maxAttempts: number;
  agentType: CompletionAgentType;
  originalPrompt: string;
  rawLogs: string;
  linearIssueId?: string;
  linearIssueLabels: string[];
  taskResult?: TaskResult;
  workerExitCode?: number;
  claudeError?: string;
}

export interface CompletionVerifierVerdict {
  passed: boolean;
  confidence: number;
  reasons: string[];
  missingCriteria: string[];
  resumeInstruction: string;
  usedLlm: boolean;
  verifierFailure?: boolean;
  extractedSummary?: string;
  planningMetadata?: {
    outcomeLabel: 'planned' | 'unclear';
    superpowersWritingPlansUsed: '0' | '1';
    planningIssueUrl?: string;
    childIssueCount?: number;
    docPath?: string;
    prUrl?: string;
    clarificationMessage?: string;
  };
  executionMetadata?: {
    outcomeLabel: 'implemented';
    superpowersExecutingPlansUsed: '0' | '1';
    superpowersRequestingCodeReviewUsed: '0' | '1';
    trivialTask: '0' | '1';
    subagents: string;
    reviewIterations: number;
    linearIssueUrl: string;
  };
}

export interface CompletionVerifier {
  verify(input: CompletionVerifierInput): Promise<CompletionVerifierVerdict>;
  describe(): { enabled: boolean; provider?: string; model?: string };
}

export interface CompletionVerifierConfig {
  model: string;
  geminiApiKey: string;
  auditLogPath: string;
}

interface DeterministicContractResult {
  ok: boolean;
  reasons: string[];
  missingCriteria: string[];
  lastAssistantMessage: string | null;
  assistantMessages: string[];
}

interface PlanningMetadataExtraction {
  outcomeLabel?: 'planned' | 'unclear';
  superpowersWritingPlansUsed?: '0' | '1';
  originalIssueUrl?: string;
  planningIssueUrl?: string;
  childIssueCount?: number;
  docPath?: string;
  prUrl?: string;
  clarificationMessage?: string;
}

interface ExecutionMetadataExtraction {
  outcomeLabel?: 'implemented';
  prUrl?: string;
  ciEvidence?: string;
  linearIssueUrl?: string;
  reviewIterations?: number;
  superpowersExecutingPlansUsed?: '0' | '1';
  superpowersRequestingCodeReviewUsed?: '0' | '1';
  trivialTask?: '0' | '1';
  subagents?: string;
  skillSequenceProof?: string;
  summary?: string;
}

const LLM_EXECUTION_METADATA_SCHEMA = z.object({
  outcomeLabel: z.literal('implemented'),
  superpowersExecutingPlansUsed: z.enum(['0', '1']),
  superpowersRequestingCodeReviewUsed: z.enum(['0', '1']),
  trivialTask: z.enum(['0', '1']),
  subagents: z
    .string()
    .nullable()
    .transform((v) => v ?? ''),
  reviewIterations: z
    .number()
    .int()
    .min(0)
    .nullable()
    .transform((v) => v ?? 0),
  linearIssueUrl: z.string().url(),
});

const LLM_VERDICT_SCHEMA = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  missingCriteria: z.array(z.string()),
  resumeInstruction: z
    .string()
    .nullable()
    .transform((v) => v ?? ''),
  extractedSummary: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined),
  executionMetadata: z
    .union([LLM_EXECUTION_METADATA_SCHEMA, z.null()])
    .optional()
    .transform((v) => v ?? undefined),
});

type LlmVerdict = z.infer<typeof LLM_VERDICT_SCHEMA>;

const VERIFIER_PRICING: Partial<Record<LLMModel, ModelPricing>> = {
  [LlmModels.Gemini25Flash]: {
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
    groundingCostPerRequest: 0,
  },
};

function normalizeMissingCriteria(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
}

function buildDefaultResumeInstruction(
  agentType: CompletionAgentType,
  missingCriteria: string[]
): string {
  /* v8 ignore start -- ts-type: defensive fallback for empty criteria list is unreachable in current verifier flow @preserve */
  const joined =
    missingCriteria.length > 0 ? missingCriteria.join('; ') : 'completion contract not met';
  /* v8 ignore stop @preserve */
  /* v8 ignore start -- source-map: coverage branch mapping reports false-uncovered path on phase selector despite direct unit tests @preserve */
  if (agentType === 'execution') {
    return `Address: ${joined}. Re-run pnpm run ci:tracked, ensure it succeeds, and finish with EXECUTION_AGENT_FINAL.`;
  }
  if (agentType === 'pull_request') {
    return `Address: ${joined}. Push changes to the PR branch, update the tracking comment, reply to the comment, and finish with PULL_REQUEST_AGENT_FINAL.`;
  }
  /* v8 ignore stop @preserve */
  return `Address: ${joined}. Finish with PLANNING_AGENT_FINAL and include planning outcome metadata.`;
}

function extractAssistantMessages(rawLogs: string): string[] {
  const assistantMessages: string[] = [];

  for (const rawLine of stripDockerHeaders(rawLogs).split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    const jsonStart = line.indexOf('{');
    if (jsonStart === -1) continue;

    try {
      const parsed = JSON.parse(line.slice(jsonStart)) as {
        type?: string;
        message?: { content?: { type?: string; text?: string }[] };
      };
      if (parsed.type !== 'assistant') continue;

      const content = parsed.message?.content;
      if (content === undefined) continue;

      const text = content
        .filter(
          (part): part is { type: 'text'; text: string } =>
            part.type === 'text' && typeof part.text === 'string'
        )
        .map((part) => part.text)
        .join('\n')
        .trim();

      if (text !== '') {
        assistantMessages.push(text);
      }
    } catch {
      // Ignore malformed/non-JSON lines.
    }
  }

  return assistantMessages;
}

function extractLastAssistantMessage(rawLogs: string): string | null {
  const assistantMessages = extractAssistantMessages(rawLogs);
  return assistantMessages.at(-1) ?? null;
}

function extractPlanningMetadataFromMessage(message: string): PlanningMetadataExtraction {
  const lines = message.split('\n').map((line) => line.trim());
  const readValue = (prefix: string): string | undefined => {
    const line = lines.find((entry) => entry.toLowerCase().startsWith(prefix.toLowerCase()));
    if (line === undefined) return undefined;
    const value = line.slice(prefix.length).trim();
    return value === '' ? undefined : value;
  };

  const outcome = readValue('- Outcome:');
  const superpowers = readValue('- superpowers_writing_plans_used:');
  const rawOriginalIssueUrl = readValue('- Original issue:');
  const originalIssueUrl =
    rawOriginalIssueUrl !== undefined
      ? stripMarkdownLink(rawOriginalIssueUrl)
      : rawOriginalIssueUrl;
  const rawPlanningIssueUrl = readValue('- Planning issue:');
  const planningIssueUrl =
    rawPlanningIssueUrl !== undefined
      ? stripMarkdownLink(rawPlanningIssueUrl)
      : rawPlanningIssueUrl;
  const childIssuesRaw = readValue('- Child issues:');
  const docPath = readValue('- Plan doc:');
  const rawPrUrl = readValue('- Planning PR:');
  const prUrl = rawPrUrl !== undefined ? stripMarkdownLink(rawPrUrl) : rawPrUrl;
  const clarificationMessage = readValue('- Clarification message:');

  return {
    ...(outcome === 'planned' || outcome === 'unclear' ? { outcomeLabel: outcome } : {}),
    ...(superpowers === '0' || superpowers === '1'
      ? { superpowersWritingPlansUsed: superpowers }
      : {}),
    ...(originalIssueUrl !== undefined ? { originalIssueUrl } : {}),
    ...(planningIssueUrl !== undefined ? { planningIssueUrl } : {}),
    ...(childIssuesRaw !== undefined && /^\d+$/u.test(childIssuesRaw)
      ? { childIssueCount: Number(childIssuesRaw) }
      : {}),
    ...(docPath !== undefined ? { docPath } : {}),
    ...(prUrl !== undefined ? { prUrl } : {}),
    /* v8 ignore start -- ts-type: conditional object spread for optional extracted field @preserve */
    ...(clarificationMessage !== undefined ? { clarificationMessage } : {}),
    /* v8 ignore stop @preserve */
  };
}

function stripMarkdownLink(value: string): string {
  const match = /^\[.*?\]\((.*?)\)$/.exec(value);
  return match?.[1] ?? value;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasGithubPrPath(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return (
      parsed.hostname === 'github.com' &&
      segments.length >= 4 &&
      segments[2] === 'pull' &&
      segments[3] !== undefined &&
      Number.isInteger(Number(segments[3]))
    );
  } catch {
    return false;
  }
}

function hasLinearIssuePath(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return parsed.hostname === 'linear.app' && segments.length >= 3 && segments[1] === 'issue';
  } catch {
    return false;
  }
}

function extractLinearIssueIdentifierFromUrl(value: string): string | undefined {
  if (!hasLinearIssuePath(value)) return undefined;
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[2];
  } catch {
    return undefined;
  }
}

function parseExecutionMetadataFromMessage(message: string): ExecutionMetadataExtraction {
  const lines = message.split('\n').map((line) => line.trim());
  const readValue = (prefix: string): string | undefined => {
    const line = lines.find((entry) => entry.toLowerCase().startsWith(prefix.toLowerCase()));
    if (line === undefined) return undefined;
    const value = line.slice(prefix.length).trim();
    return value === '' ? undefined : value;
  };

  const outcome = readValue('- Outcome:');
  const rawPrUrl = readValue('- PR:');
  const prUrl = rawPrUrl !== undefined ? stripMarkdownLink(rawPrUrl) : rawPrUrl;
  const ciEvidence = readValue('- CI evidence:');
  const rawLinearIssueUrl = readValue('- Linear issue:');
  const linearIssueUrl =
    rawLinearIssueUrl !== undefined ? stripMarkdownLink(rawLinearIssueUrl) : rawLinearIssueUrl;
  const reviewIterationsRaw = readValue('- Review iterations:');
  const execPlansUsed = readValue('- superpowers_executing_plans_used:');
  const codeReviewUsed = readValue('- superpowers_requesting_code_review_used:');
  const trivialTask = readValue('- trivial_task:');
  const subagents = readValue('- subagents:');
  const skillSequenceProof = readValue('- Skill sequence proof:');
  const summary = readValue('- Summary:');

  let reviewIterations: number | undefined;
  if (
    reviewIterationsRaw !== undefined &&
    reviewIterationsRaw !== '' &&
    /^\d+$/u.test(reviewIterationsRaw)
  ) {
    reviewIterations = Number(reviewIterationsRaw);
  }

  return {
    ...(outcome === 'implemented' ? { outcomeLabel: 'implemented' as const } : {}),
    ...(prUrl !== undefined ? { prUrl } : {}),
    ...(ciEvidence !== undefined ? { ciEvidence } : {}),
    ...(linearIssueUrl !== undefined ? { linearIssueUrl } : {}),
    ...(reviewIterations !== undefined ? { reviewIterations } : {}),
    ...(execPlansUsed === '0' || execPlansUsed === '1'
      ? { superpowersExecutingPlansUsed: execPlansUsed }
      : {}),
    ...(codeReviewUsed === '0' || codeReviewUsed === '1'
      ? { superpowersRequestingCodeReviewUsed: codeReviewUsed }
      : {}),
    ...(trivialTask === '0' || trivialTask === '1' ? { trivialTask } : {}),
    ...(subagents !== undefined ? { subagents } : {}),
    ...(skillSequenceProof !== undefined ? { skillSequenceProof } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
}

function verifyPlanningAgentFinal(
  message: string
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!message.includes('PLANNING_AGENT_FINAL:')) {
    missing.push('PLANNING_AGENT_FINAL block');
  }
  const extracted = extractPlanningMetadataFromMessage(message);
  const summaryLine = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith('- summary:'));

  if (extracted.outcomeLabel === undefined) missing.push('Outcome line');
  if (extracted.superpowersWritingPlansUsed === undefined)
    missing.push('superpowers_writing_plans_used line');
  if (extracted.superpowersWritingPlansUsed !== '1')
    missing.push('superpowers_writing_plans_used must be 1');
  if (extracted.originalIssueUrl === undefined) missing.push('Original issue URL line');
  if (summaryLine === undefined || summaryLine.slice('- Summary:'.length).trim() === '') {
    missing.push('Summary line');
  }

  /* v8 ignore start -- test-infra: planned/unclear branch combinations are partially covered by higher-level verifier tests @preserve */
  if (extracted.outcomeLabel === 'planned' && extracted.planningIssueUrl === undefined) {
    missing.push('Planning issue URL line');
  }
  if (extracted.outcomeLabel === 'unclear' && extracted.clarificationMessage === undefined) {
    missing.push('Clarification message line');
  }
  /* v8 ignore stop @preserve */

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true };
}

function verifyExecutionAgentFinal(
  message: string
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];

  if (!message.includes('EXECUTION_AGENT_FINAL:')) {
    missing.push('EXECUTION_AGENT_FINAL block');
  }
  const extracted = parseExecutionMetadataFromMessage(message);
  if (extracted.outcomeLabel !== 'implemented') missing.push('Outcome line (implemented)');
  if (extracted.prUrl === undefined || !hasGithubPrPath(extracted.prUrl))
    missing.push('PR URL line');
  if (extracted.ciEvidence !== 'pnpm run ci:tracked successful') missing.push('CI evidence line');
  if (extracted.linearIssueUrl === undefined || !hasLinearIssuePath(extracted.linearIssueUrl))
    missing.push('Linear issue URL line');
  if (extracted.reviewIterations === undefined) missing.push('Review iterations line');
  if (extracted.superpowersExecutingPlansUsed === undefined)
    missing.push('superpowers_executing_plans_used line');
  if (extracted.superpowersRequestingCodeReviewUsed === undefined)
    missing.push('superpowers_requesting_code_review_used line');
  if (extracted.trivialTask === undefined) missing.push('trivial_task line');
  if (extracted.subagents === undefined) missing.push('subagents line');
  if (extracted.skillSequenceProof === undefined) missing.push('Skill sequence proof line');
  if ((extracted.summary ?? '').trim() === '') missing.push('Summary line');

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true };
}

function verifyPRCommentFinal(message: string): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];

  if (!message.includes('PULL_REQUEST_AGENT_FINAL:')) {
    missing.push('PULL_REQUEST_AGENT_FINAL block');
  }

  const prMatch = /- PR:\s*(https:\/\/github\.com\/\S+\/pull\/\d+)\s*$/im.exec(message);
  const ciMatch = /- CI evidence:\s*pnpm run ci:tracked successful\s*$/im.exec(message);
  const linearMatch = /- Linear issue:\s*(https:\/\/linear\.app\/\S+)\s*$/im.exec(message);
  const commentMatch = /- Comment replied:\s*(yes|no)\s*$/im.exec(message);
  const trackingMatch = /- Tracking comment:\s*(updated|not_applicable)\s*$/im.exec(message);
  const summaryMatch = /- Summary:\s*(.+)\s*$/im.exec(message);

  if (prMatch?.[1] === undefined) missing.push('PR URL line');
  if (ciMatch?.[0] === undefined) missing.push('CI evidence line');
  if (linearMatch?.[1] === undefined) missing.push('Linear issue URL line');
  if (commentMatch?.[1] === undefined) missing.push('Comment replied line');
  if (trackingMatch?.[1] === undefined) missing.push('Tracking comment line');
  if ((summaryMatch?.[1] ?? '').trim() === '') missing.push('Summary line');

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true };
}

export class OrchestratorCompletionVerifier implements CompletionVerifier {
  private readonly llmClient: LlmGenerateClient;
  private readonly model: string;

  constructor(
    private readonly logger: Logger,
    config: CompletionVerifierConfig
  ) {
    this.model = config.model;
    this.llmClient = this.createLlmClient(config);
  }

  describe(): { enabled: boolean; provider?: string; model?: string } {
    return {
      enabled: true,
      provider: 'gemini',
      model: this.model,
    };
  }

  async verify(input: CompletionVerifierInput): Promise<CompletionVerifierVerdict> {
    const deterministic = this.runDeterministicChecks(input);
    const llmVerdict = await this.runLlmAdjudication(
      input,
      deterministic.lastAssistantMessage ?? '',
      deterministic
    );
    if (!llmVerdict.ok) {
      const fallbackMissing = normalizeMissingCriteria([
        ...deterministic.missingCriteria,
        'Gemini verifier response',
      ]);
      return {
        passed: false,
        confidence: 0,
        reasons: normalizeMissingCriteria([
          ...deterministic.reasons,
          `Gemini verifier ${llmVerdict.error.startsWith('schema mismatch:') ? llmVerdict.error : `unavailable: ${llmVerdict.error}`}`,
        ]),
        missingCriteria: fallbackMissing,
        /* v8 ignore start -- source-map: cond-expr branch is misattributed to this property line after bundling/source-map transforms @preserve */
        resumeInstruction: buildDefaultResumeInstruction(input.agentType, fallbackMissing),
        /* v8 ignore stop @preserve */
        usedLlm: true,
        verifierFailure: true,
      };
    }

    const parsedVerdict = llmVerdict.value;
    if (input.agentType !== 'execution' && parsedVerdict.executionMetadata !== undefined) {
      this.logger.warn(
        {
          taskId: input.taskId,
          agentType: input.agentType,
        },
        'Gemini returned executionMetadata for non-execution task; discarding'
      );
    }
    let mergedReasons = parsedVerdict.reasons;
    let mergedMissingCriteria = normalizeMissingCriteria(parsedVerdict.missingCriteria);
    if (!parsedVerdict.passed) {
      mergedReasons = normalizeMissingCriteria([
        ...parsedVerdict.reasons,
        ...deterministic.reasons,
      ]);
      mergedMissingCriteria = normalizeMissingCriteria([
        ...parsedVerdict.missingCriteria,
        ...deterministic.missingCriteria,
      ]);
    }

    const extractedPlanningMetadata =
      input.agentType === 'planning' && deterministic.lastAssistantMessage !== null
        ? ((): NonNullable<CompletionVerifierVerdict['planningMetadata']> | null => {
            const extracted = extractPlanningMetadataFromMessage(
              deterministic.lastAssistantMessage
            );
            if (
              extracted.outcomeLabel === undefined ||
              extracted.superpowersWritingPlansUsed === undefined
            ) {
              return null;
            }
            return {
              outcomeLabel: extracted.outcomeLabel,
              superpowersWritingPlansUsed: extracted.superpowersWritingPlansUsed,
              ...(extracted.planningIssueUrl !== undefined && {
                planningIssueUrl: extracted.planningIssueUrl,
              }),
              ...(extracted.childIssueCount !== undefined && {
                childIssueCount: extracted.childIssueCount,
              }),
              ...(extracted.docPath !== undefined && { docPath: extracted.docPath }),
              ...(extracted.prUrl !== undefined && { prUrl: extracted.prUrl }),
              /* v8 ignore start -- ts-type: conditional object spread for optional extracted field @preserve */
              ...(extracted.clarificationMessage !== undefined && {
                clarificationMessage: extracted.clarificationMessage,
              }),
              /* v8 ignore stop @preserve */
            };
          })()
        : null;

    const extractedExecutionMetadata =
      input.agentType === 'execution'
        ? ((): NonNullable<CompletionVerifierVerdict['executionMetadata']> | undefined => {
            const parsedExecutionMetadata = parsedVerdict.executionMetadata;
            if (parsedExecutionMetadata !== undefined) {
              return parsedExecutionMetadata;
            }
            if (deterministic.lastAssistantMessage === null) return undefined;
            const extracted = parseExecutionMetadataFromMessage(deterministic.lastAssistantMessage);
            if (
              extracted.outcomeLabel !== 'implemented' ||
              extracted.superpowersExecutingPlansUsed === undefined ||
              extracted.superpowersRequestingCodeReviewUsed === undefined ||
              extracted.trivialTask === undefined ||
              extracted.subagents === undefined ||
              extracted.reviewIterations === undefined ||
              extracted.linearIssueUrl === undefined
            ) {
              return undefined;
            }
            return {
              outcomeLabel: extracted.outcomeLabel,
              superpowersExecutingPlansUsed: extracted.superpowersExecutingPlansUsed,
              superpowersRequestingCodeReviewUsed: extracted.superpowersRequestingCodeReviewUsed,
              trivialTask: extracted.trivialTask,
              subagents: extracted.subagents,
              reviewIterations: extracted.reviewIterations,
              linearIssueUrl: extracted.linearIssueUrl,
            } satisfies NonNullable<CompletionVerifierVerdict['executionMetadata']>;
          })()
        : undefined;

    if (input.agentType === 'execution' && parsedVerdict.passed) {
      if (extractedExecutionMetadata === undefined) {
        mergedReasons = normalizeMissingCriteria([
          ...mergedReasons,
          'Execution Agent metadata extraction failed',
        ]);
        mergedMissingCriteria = normalizeMissingCriteria([
          ...mergedMissingCriteria,
          'execution metadata extraction',
        ]);
      } else if (input.linearIssueId !== undefined) {
        const routedIdentifier = input.linearIssueId.trim().toLowerCase();
        const reportedIdentifier = extractLinearIssueIdentifierFromUrl(
          extractedExecutionMetadata.linearIssueUrl
        )
          ?.trim()
          .toLowerCase();
        if (reportedIdentifier === undefined || reportedIdentifier !== routedIdentifier) {
          mergedReasons = normalizeMissingCriteria([
            ...mergedReasons,
            'Execution Agent reported a different Linear issue than the routed task target',
          ]);
          mergedMissingCriteria = normalizeMissingCriteria([
            ...mergedMissingCriteria,
            `Execution Agent final block Linear issue URL must match routed issue ${input.linearIssueId}`,
          ]);
        }
      }
    }

    const executionLinearIssueMismatch =
      input.agentType === 'execution' &&
      parsedVerdict.passed &&
      extractedExecutionMetadata !== undefined &&
      input.linearIssueId !== undefined &&
      extractLinearIssueIdentifierFromUrl(extractedExecutionMetadata.linearIssueUrl)
        ?.trim()
        .toLowerCase() !== input.linearIssueId.trim().toLowerCase();

    const forcedExecutionFailure =
      input.agentType === 'execution' &&
      parsedVerdict.passed &&
      (extractedExecutionMetadata === undefined || executionLinearIssueMismatch);
    const passed = forcedExecutionFailure ? false : parsedVerdict.passed;
    const resumeInstruction =
      forcedExecutionFailure && mergedMissingCriteria.length > 0
        ? buildDefaultResumeInstruction(input.agentType, mergedMissingCriteria)
        : parsedVerdict.resumeInstruction;

    return {
      passed,
      confidence: parsedVerdict.confidence,
      reasons: mergedReasons,
      missingCriteria: mergedMissingCriteria,
      resumeInstruction,
      usedLlm: true,
      verifierFailure: false,
      ...(extractedPlanningMetadata !== null && { planningMetadata: extractedPlanningMetadata }),
      ...(extractedExecutionMetadata !== undefined && {
        executionMetadata: extractedExecutionMetadata,
      }),
      ...(parsedVerdict.extractedSummary !== undefined &&
        parsedVerdict.extractedSummary !== '' && {
          extractedSummary: parsedVerdict.extractedSummary,
        }),
    };
  }

  private runDeterministicChecks(input: CompletionVerifierInput): DeterministicContractResult {
    const reasons: string[] = [];
    const missingCriteria: string[] = [];

    if (input.agentType !== 'execution') {
      if (input.claudeError !== undefined && input.claudeError !== '') {
        reasons.push('Claude stream reported an explicit error');
        missingCriteria.push(`Claude error: ${input.claudeError}`);
      }

      if (typeof input.workerExitCode === 'number' && input.workerExitCode !== 0) {
        reasons.push('Worker exited with non-zero code');
        missingCriteria.push(`Worker exit code ${String(input.workerExitCode)}`);
      }
    }

    const assistantMessages = extractAssistantMessages(input.rawLogs);
    const lastAssistantMessage = assistantMessages.at(-1) ?? null;
    if (lastAssistantMessage === null) {
      reasons.push('Missing assistant final message in worker logs');
      missingCriteria.push('Assistant final message');
    }

    if (lastAssistantMessage !== null) {
      if (input.agentType === 'planning') {
        const agentResult = verifyPlanningAgentFinal(lastAssistantMessage);
        if (!agentResult.ok) {
          reasons.push('Planning Agent completion contract was not met');
          missingCriteria.push(...agentResult.missing);
        }
      } else if (input.agentType === 'pull_request') {
        const agentResult = verifyPRCommentFinal(lastAssistantMessage);
        if (!agentResult.ok) {
          reasons.push('Pull Request Agent completion contract was not met');
          missingCriteria.push(...agentResult.missing);
        }

        // For PR comment, we don't require a new PR (they push to existing PR)
        // but we still check CI passed
        if (input.taskResult?.ciFailed === true) {
          reasons.push('GitHub checks reported failing statuses');
          missingCriteria.push('Successful GitHub checks for PR branch');
        }

        if (input.taskResult?.ciFailed === undefined) {
          reasons.push('Could not determine GitHub checks status');
          missingCriteria.push('Confirmed GitHub checks status');
        }
      } else {
        // Execution Agent completion is verified semantically by Gemini using Claude responses only.
        // No regex-based parsing or runtime-signal gating here.
      }
    }

    return {
      ok: missingCriteria.length === 0,
      reasons,
      missingCriteria,
      lastAssistantMessage,
      assistantMessages,
    };
  }

  private async runLlmAdjudication(
    input: CompletionVerifierInput,
    lastAssistantMessage: string,
    deterministic: DeterministicContractResult
  ): Promise<{ ok: true; value: LlmVerdict } | { ok: false; error: string }> {
    const recentAssistantMessages = deterministic.assistantMessages.slice(-3);
    const previousAssistantMessages = recentAssistantMessages.slice(0, -1);
    const terminalExcerpt = stripDockerHeaders(input.rawLogs)
      .split('\n')
      .slice(-120)
      .join('\n')
      .slice(0, 20_000);

    const requiredContractText =
      input.agentType === 'planning'
        ? [
            'PLANNING_AGENT_FINAL:',
            '- Outcome: <planned|unclear>',
            '- superpowers_writing_plans_used: 1',
            '- Original issue: <full Linear URL>',
            '- Summary: <3-5 sentences>',
          ].join('\n')
        : input.agentType === 'pull_request'
          ? [
              'PULL_REQUEST_AGENT_FINAL:',
              '- PR: <full GitHub PR URL>',
              '- CI evidence: pnpm run ci:tracked successful',
              '- Linear issue: <full Linear URL>',
              '- Comment replied: <yes|no>',
              '- Tracking comment: <updated|not_applicable>',
              '- Summary: <3-5 sentences>',
            ].join('\n')
          : [
              'EXECUTION_AGENT_FINAL:',
              '- Outcome: implemented',
              '- PR: <full GitHub PR URL>',
              '- CI evidence: pnpm run ci:tracked successful',
              '- Linear issue: <full Linear URL>',
              '- Review iterations: <number>',
              '- superpowers_executing_plans_used: <0|1> (must be 1)',
              '- superpowers_requesting_code_review_used: <0|1> (must be 1)',
              '- trivial_task: <0|1>',
              '- subagents: <explicit role + scope list; may be none only if trivial_task=1>',
              '- Skill sequence proof: <must show superpowers:executing-plans before superpowers:requesting-code-review>',
              '- Summary: <3-5 sentences>',
            ].join('\n');

    const responseSchemaLine =
      '{"passed":boolean,"confidence":number (0.0-1.0),"reasons":string[],"missingCriteria":string[],"resumeInstruction":string,"extractedSummary":string,"executionMetadata":{"outcomeLabel":"implemented","superpowersExecutingPlansUsed":"0|1","superpowersRequestingCodeReviewUsed":"0|1","trivialTask":"0|1","subagents":string,"reviewIterations":number,"linearIssueUrl":string}|null}';

    const verifierPrompt =
      input.agentType === 'execution'
        ? [
            'You are a strict task-completion verifier for the Execution Agent.',
            'Decide PASS or FAIL only.',
            'Evidence source is Claude responses only (no runtime/log signal adjudication).',
            'Use the latest Claude response as primary evidence. Use previous Claude responses only as fallback.',
            'Do not judge code quality.',
            'If evidence is missing or ambiguous, return FAIL.',
            'Return JSON only with the exact schema:',
            responseSchemaLine,
            '',
            `TASK ${input.taskId} ATTEMPT ${String(input.attempt)}/${String(input.maxAttempts)} AGENT execution`,
            `ROUTED_LINEAR_ISSUE_ID: ${input.linearIssueId ?? 'unknown'}`,
            '',
            'Original objective:',
            input.originalPrompt,
            '',
            'Required contract:',
            requiredContractText,
            '',
            'Latest Claude response (PRIMARY EVIDENCE):',
            lastAssistantMessage,
            '',
            'Previous Claude responses (FALLBACK ONLY):',
            previousAssistantMessages.length > 0
              ? previousAssistantMessages.join('\n\n---\n\n')
              : 'none',
            '',
            'Execution Agent hard rules:',
            '- Verify EXECUTION_AGENT_FINAL semantic presence.',
            '- Outcome must be implemented.',
            '- superpowers_executing_plans_used must be 1.',
            '- superpowers_requesting_code_review_used must be 1.',
            '- Skill sequence proof must show executing-plans before requesting-code-review.',
            '- trivial_task must be present.',
            '- If trivial_task=0, subagents must be an explicit list with role + scope. "none" or empty is invalid.',
            '- If trivial_task=1, subagents may be none/empty.',
            '- PR URL, CI evidence statement, review iterations, and executed Linear issue URL must be present.',
            '- If the final block Linear issue URL clearly points to a different issue than the routed task, return passed=false.',
            '- Confidence is informational only, not a pass threshold.',
            '',
            'Resume instruction rule:',
            '- Return a targeted gap-fill instruction for missing items; do not ask for a full rewrite unless unusable.',
            '',
            'Extraction rule (required for execution):',
            '- Populate executionMetadata from the Execution Agent final block when possible.',
            '- reviewIterations must be numeric in executionMetadata.',
            '- If execution evidence is insufficient, set executionMetadata to null.',
            '',
            'Summary extraction:',
            '- Always include extractedSummary (3-5 factual sentences, third-person).',
            '- Prefer the final-block Summary line if present; otherwise summarize from Claude responses only.',
          ].join('\n')
        : [
            'You are a strict task-completion verifier.',
            'Decide only one thing: PASS or FAIL for this attempt.',
            'Use only provided evidence.',
            'Do not judge code quality.',
            'If evidence is missing, return FAIL.',
            'Return JSON only with the exact schema:',
            responseSchemaLine,
            '',
            `TASK ${input.taskId} ATTEMPT ${String(input.attempt)}/${String(input.maxAttempts)} AGENT ${input.agentType}`,
            '',
            'Original objective:',
            input.originalPrompt,
            '',
            'Required contract:',
            requiredContractText,
            '',
            'Deterministic signals:',
            `- workerExitCode=${String(input.workerExitCode ?? 'none')}`,
            `- detectedPrUrl=${input.taskResult?.prUrl ?? 'null'}`,
            `- detectedCiTrackedSuccess=${String(input.taskResult?.ciFailed === false)}`,
            `- deterministicPassed=${String(deterministic.ok)}`,
            `- deterministicReasons=${deterministic.reasons.length > 0 ? deterministic.reasons.join('; ') : 'none'}`,
            `- deterministicMissingCriteria=${deterministic.missingCriteria.length > 0 ? deterministic.missingCriteria.join('; ') : 'none'}`,
            '',
            'Last assistant message:',
            lastAssistantMessage,
            '',
            'Last logs excerpt:',
            terminalExcerpt,
            '',
            'Summary extraction:',
            '- Always include "extractedSummary": a 3-5 sentence objective narrative of what happened.',
            '- First, look for the "- Summary:" line in the assistant final block and use its content.',
            '- If that line is missing or contains only a few words, write your own summary based on the assistant messages and logs.',
            '- Describe what was analyzed/implemented, key decisions, outcomes, and deliverables.',
            '- If the task failed, describe what was attempted and where it failed.',
            '- Keep it factual and third-person.',
            '',
            'Hard rules for this decision:',
            '- If deterministic signals show explicit Claude error, non-zero worker exit, or missing required final contract lines, return passed=false.',
            '- If you cannot verify all required items from provided evidence, return passed=false.',
            '',
            'Return PASS only if all required contract items are present with evidence.',
            'Otherwise return FAIL with missing criteria and one short next instruction.',
          ].join('\n');

    this.logger.info(
      {
        taskId: input.taskId,
        attempt: input.attempt,
        maxAttempts: input.maxAttempts,
        agentType: input.agentType,
        model: this.model,
        promptChars: verifierPrompt.length,
      },
      'Gemini completion verifier request'
    );

    const generated = await this.llmClient.generate(verifierPrompt);
    if (!generated.ok) {
      this.logger.error(
        {
          taskId: input.taskId,
          attempt: input.attempt,
          model: this.model,
          errorCode: generated.error.code,
          errorMessage: generated.error.message,
        },
        'Gemini completion verifier returned no response'
      );
      return { ok: false, error: generated.error.message };
    }

    this.logger.info(
      {
        taskId: input.taskId,
        attempt: input.attempt,
        model: this.model,
        responseChars: generated.value.content.length,
      },
      'Gemini completion verifier response'
    );

    try {
      const parsed = this.extractAndParseJson(generated.value.content);
      this.logger.info(
        {
          taskId: input.taskId,
          attempt: input.attempt,
          model: this.model,
          verdict: parsed,
        },
        'Gemini completion verifier parsed verdict'
      );
      return { ok: true, value: parsed };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(
        {
          taskId: input.taskId,
          attempt: input.attempt,
          model: this.model,
          response: generated.value.content,
          error: errorMessage,
        },
        'Gemini completion verifier response parsing failed'
      );
      return { ok: false, error: `schema mismatch: ${errorMessage}` };
    }
  }

  private extractAndParseJson(content: string): LlmVerdict {
    const trimmed = content.trim();

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return LLM_VERDICT_SCHEMA.parse(JSON.parse(trimmed));
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return LLM_VERDICT_SCHEMA.parse(JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)));
    }

    throw new Error('LLM verifier response is not valid JSON');
  }

  private createLlmClient(config: CompletionVerifierConfig): LlmGenerateClient {
    if (config.model !== LlmModels.Gemini25Flash) {
      throw new Error('Completion verifier must use model gemini-2.5-flash');
    }

    const pricing = VERIFIER_PRICING[config.model];
    /* v8 ignore start -- upstream: model guard above guarantees Gemini pricing entry exists @preserve */
    if (pricing === undefined) {
      throw new Error(`Missing completion verifier pricing entry for model: ${config.model}`);
    }
    /* v8 ignore stop @preserve */

    if (config.geminiApiKey === '') {
      throw new Error('INTEXURAOS_GEMINI_APP_API_KEY is required');
    }

    if (config.auditLogPath === '') {
      throw new Error('Completion verifier auditLogPath is required');
    }

    return createLlmClient({
      apiKey: config.geminiApiKey,
      model: config.model,
      userId: 'orchestrator-completion-verifier',
      pricing,
      logger: this.logger,
      auditSink: new OrchestratorFileAuditSink({
        logger: this.logger,
        auditLogPath: config.auditLogPath,
      }),
      usageSink: new StructuredLogUsageSink({ logger: this.logger }),
    });
  }
}

export const CompletionVerifierTestUtils = {
  extractLastAssistantMessage,
  verifyPlanningAgentFinal,
  verifyExecutionAgentFinal,
  verifyPRCommentFinal,
  buildDefaultResumeInstruction,
  stripMarkdownLink,
};
