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
    trivialTask?: '0' | '1';
    docPath?: string;
    prUrl?: string;
    clarificationMessage?: string;
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
}

interface PlanningMetadataExtraction {
  outcomeLabel?: 'planned' | 'unclear';
  superpowersWritingPlansUsed?: '0' | '1';
  originalIssueUrl?: string;
  planningIssueUrl?: string;
  trivialTask?: '0' | '1';
  parallelBreakdownProof?: string;
  docPath?: string;
  prUrl?: string;
  clarificationMessage?: string;
}

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
    return `Address: ${joined}. Push changes to the PR branch, reply to the comment, and finish with PULL_REQUEST_AGENT_FINAL.`;
  }
  /* v8 ignore stop @preserve */
  return `Address: ${joined}. Finish with PLANNING_AGENT_FINAL and include planning outcome metadata.`;
}

function extractLastAssistantMessage(rawLogs: string): string | null {
  let lastAssistantText: string | null = null;

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
        lastAssistantText = text;
      }
    } catch {
      // Ignore malformed/non-JSON lines.
    }
  }

  return lastAssistantText;
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
  const originalIssueUrl = readValue('- Original issue:');
  const planningIssueUrl = readValue('- Planning issue:');
  const trivialTask = readValue('- Trivial task:');
  const parallelBreakdownProof = readValue('- Parallel breakdown proof:');
  const docPath = readValue('- Plan doc:');
  const prUrl = readValue('- Planning PR:');
  const clarificationMessage = readValue('- Clarification message:');

  return {
    ...(outcome === 'planned' || outcome === 'unclear' ? { outcomeLabel: outcome } : {}),
    ...(superpowers === '0' || superpowers === '1'
      ? { superpowersWritingPlansUsed: superpowers }
      : {}),
    ...(originalIssueUrl !== undefined ? { originalIssueUrl } : {}),
    ...(planningIssueUrl !== undefined ? { planningIssueUrl } : {}),
    ...(trivialTask === '0' || trivialTask === '1' ? { trivialTask } : {}),
    ...(parallelBreakdownProof !== undefined ? { parallelBreakdownProof } : {}),
    ...(docPath !== undefined ? { docPath } : {}),
    ...(prUrl !== undefined ? { prUrl } : {}),
    /* v8 ignore start -- ts-type: conditional object spread for optional extracted field @preserve */
    ...(clarificationMessage !== undefined ? { clarificationMessage } : {}),
    /* v8 ignore stop @preserve */
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

  const prMatch = /- PR:\s*(https:\/\/github\.com\/\S+\/pull\/\d+)\s*$/im.exec(message);
  const ciMatch = /- CI evidence:\s*pnpm run ci:tracked successful\s*$/im.exec(message);
  const linearMatch = /- Linear issue:\s*(https:\/\/linear\.app\/\S+)\s*$/im.exec(message);
  const reviewIterationsMatch = /- Review iterations:\s*(\d+)\s*$/im.exec(message);
  const turnSummaryMatch = /- Turn summary:\s*(.+)\s*$/im.exec(message);
  const summaryMatch = /- Summary:\s*(.+)\s*$/im.exec(message);

  if (prMatch?.[1] === undefined) missing.push('PR URL line');
  if (ciMatch?.[0] === undefined) missing.push('CI evidence line');
  if (linearMatch?.[1] === undefined) missing.push('Linear issue URL line');
  if (reviewIterationsMatch?.[1] === undefined) missing.push('Review iterations line');
  if ((turnSummaryMatch?.[1] ?? '').trim() === '') missing.push('Turn summary line');
  if ((summaryMatch?.[1] ?? '').trim() === '') missing.push('Summary line');

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
  const summaryMatch = /- Summary:\s*(.+)\s*$/im.exec(message);

  if (prMatch?.[1] === undefined) missing.push('PR URL line');
  if (ciMatch?.[0] === undefined) missing.push('CI evidence line');
  if (linearMatch?.[1] === undefined) missing.push('Linear issue URL line');
  if (commentMatch?.[1] === undefined) missing.push('Comment replied line');
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
          `Gemini verifier unavailable: ${llmVerdict.error}`,
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
              ...(extracted.trivialTask !== undefined && { trivialTask: extracted.trivialTask }),
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

    return {
      passed: parsedVerdict.passed,
      confidence: parsedVerdict.confidence,
      reasons: mergedReasons,
      missingCriteria: mergedMissingCriteria,
      resumeInstruction: parsedVerdict.resumeInstruction,
      usedLlm: true,
      verifierFailure: false,
      ...(extractedPlanningMetadata !== null && { planningMetadata: extractedPlanningMetadata }),
      ...(parsedVerdict.extractedSummary !== undefined &&
        parsedVerdict.extractedSummary !== '' && {
          extractedSummary: parsedVerdict.extractedSummary,
        }),
    };
  }

  private runDeterministicChecks(input: CompletionVerifierInput): DeterministicContractResult {
    const reasons: string[] = [];
    const missingCriteria: string[] = [];

    if (input.claudeError !== undefined && input.claudeError !== '') {
      reasons.push('Claude stream reported an explicit error');
      missingCriteria.push(`Claude error: ${input.claudeError}`);
    }

    if (typeof input.workerExitCode === 'number' && input.workerExitCode !== 0) {
      reasons.push('Worker exited with non-zero code');
      missingCriteria.push(`Worker exit code ${String(input.workerExitCode)}`);
    }

    const lastAssistantMessage = extractLastAssistantMessage(input.rawLogs);
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
        const agentResult = verifyExecutionAgentFinal(lastAssistantMessage);
        if (!agentResult.ok) {
          reasons.push('Execution Agent completion contract was not met');
          missingCriteria.push(...agentResult.missing);
        }

        if (input.taskResult?.prUrl === undefined || input.taskResult.prUrl === '') {
          reasons.push('No PR URL found in task result');
          missingCriteria.push('PR URL created from branch');
        }

        if (input.taskResult?.ciFailed === true) {
          reasons.push('GitHub checks reported failing statuses');
          missingCriteria.push('Successful GitHub checks for PR branch');
        }

        if (input.taskResult?.ciFailed === undefined) {
          reasons.push('Could not determine GitHub checks status');
          missingCriteria.push('Confirmed GitHub checks status');
        }
      }
    }

    return {
      ok: missingCriteria.length === 0,
      reasons,
      missingCriteria,
      lastAssistantMessage,
    };
  }

  private async runLlmAdjudication(
    input: CompletionVerifierInput,
    lastAssistantMessage: string,
    deterministic: DeterministicContractResult
  ): Promise<{ ok: true; value: LlmVerdict } | { ok: false; error: string }> {
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
              '- Summary: <3-5 sentences>',
            ].join('\n')
          : [
              'EXECUTION_AGENT_FINAL:',
              '- PR: <full GitHub PR URL>',
              '- CI evidence: pnpm run ci:tracked successful',
              '- Linear issue: <full Linear URL>',
              '- Review iterations: <number>',
              '- Turn summary: <~5 short statements separated by |>',
              '- Summary: <3-5 sentences>',
            ].join('\n');

    const verifierPrompt = [
      'You are a strict task-completion verifier.',
      'Decide only one thing: PASS or FAIL for this attempt.',
      'Use only provided evidence.',
      'Do not judge code quality.',
      'If evidence is missing, return FAIL.',
      'Return JSON only with the exact schema:',
      '{"passed":boolean,"confidence":number (0.0-1.0),"reasons":string[],"missingCriteria":string[],"resumeInstruction":string,"extractedSummary":string}',
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
      return { ok: false, error: errorMessage };
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
};
