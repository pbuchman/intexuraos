import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  LlmModels,
  type Gemini25Flash,
  type LLMModel,
  type ModelPricing,
} from '@intexuraos/llm-contract';
import { StructuredLogUsageSink } from '@intexuraos/llm-pricing';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecutionAgentData } from './completion-verifier.js';
import { OrchestratorFileAuditSink } from './orchestrator-audit-sink.js';

const execFileAsync = promisify(execFile);

export const DEEP_VALIDATION_PROMPT_VERSION = '3.0.0';

const MAX_TRANSCRIPT_CHARS = 200_000;
const MAX_MARKDOWN_RESPONSE_CHARS = 4_000;
const TRUNCATED_MARKDOWN_MARKER = '\n\n[truncated by orchestrator]';

export type ExecutionAgentClaims = Omit<ExecutionAgentData, 'agentType'>;

export interface DeepValidationPromptInput {
  formattedTranscript: string;
  agentClaims: ExecutionAgentClaims;
  linearIssueBody: string;
  planContent: string | undefined; // @allow-undefined-type -- callers always provide the key, value may be undefined
}

export function buildDeepValidationPrompt(input: DeepValidationPromptInput): string {
  const claimsJson = JSON.stringify(input.agentClaims, null, 2);
  const planSection =
    input.planContent !== undefined
      ? `Plan document content:\n${input.planContent}`
      : 'No plan document referenced in Linear issue.';

  const transcript =
    input.formattedTranscript.length > MAX_TRANSCRIPT_CHARS
      ? input.formattedTranscript.slice(0, MAX_TRANSCRIPT_CHARS) +
        `\n\n[TRANSCRIPT TRUNCATED at ${String(MAX_TRANSCRIPT_CHARS)} chars — ${String(input.formattedTranscript.length)} total]`
      : input.formattedTranscript;

  return [
    `[deep-validation-prompt v${DEEP_VALIDATION_PROMPT_VERSION}]`,
    'You are a post-execution validator for an autonomous coding agent.',
    'Analyze the full session transcript below and write a concise validation note for human review on the PR.',
    'Return ONLY markdown.',
    'Do not return JSON, tables, or code fences.',
    'Use these headings exactly and in this order:',
    '#### Overall',
    '#### Claim Verification',
    '#### Contract Verification',
    '#### Plan vs Reality',
    '#### Anomalies',
    'Under each heading, use short "-" bullet points.',
    'If a section has nothing noteworthy, write "- None."',
    `Keep the entire response under ${String(MAX_MARKDOWN_RESPONSE_CHARS)} characters.`,
    '',
    '=== Section 1: Claim Verification ===',
    'The agent made these claims in its final report:',
    claimsJson,
    '',
    'For each claim, confirm or contradict it with transcript evidence.',
    'Specifically check:',
    '- Was pnpm run ci:tracked called? What was the exit code in the tool_result?',
    '- Was the Skill tool called with superpowers:requesting-code-review? After loading, was an Agent or Task tool dispatched as a subagent?',
    '- Was the Skill tool called with superpowers:executing-plans?',
    '- Was a PR created via gh pr create? What URL was returned?',
    '- How many git commit tool calls succeeded?',
    '',
    '=== Section 2: Contract Verification ===',
    'The execution system prompt mandates this skill sequence:',
    '1. superpowers:executing-plans must be invoked first (via Skill tool)',
    '2. superpowers:requesting-code-review must be invoked second (via Skill tool)',
    '3. After requesting-code-review is loaded, the agent MUST dispatch a code-reviewer subagent (via Agent tool with subagent_type containing "code-reviewer")',
    '',
    'Check:',
    '- Was each mandatory skill loaded? In what order?',
    '- For requesting-code-review: was the core instruction actually followed through?',
    '- Were there any skills loaded whose instructions were not followed?',
    '',
    '=== Section 3: Plan vs Reality ===',
    `Linear issue requirements:\n${input.linearIssueBody}`,
    '',
    planSection,
    '',
    'Map each requirement from the Linear issue and plan to transcript evidence.',
    'Call out anything missed or only partially addressed.',
    '',
    '=== Section 4: Anomalies ===',
    'Report anomalies such as:',
    '- Errors encountered then ignored',
    '- Laziness patterns',
    '- Fabrication',
    '- Any wrong conclusion drawn from a failed tool call',
    '',
    'For every finding, include the specific MSG-NNN reference from the transcript.',
    '',
    '=== Full Session Transcript ===',
    transcript,
  ].join('\n');
}

const DEEP_VALIDATOR_PRICING: Partial<Record<LLMModel, ModelPricing>> = {
  [LlmModels.Gemini25Flash]: {
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
    groundingCostPerRequest: 0,
  },
};

export interface ExecutionDeepValidatorConfig {
  model: Gemini25Flash;
  geminiApiKey: string;
  auditLogPath: string;
}

export interface DeepValidationInput {
  taskId: string;
  prNumber: number;
  repository: string;
  formattedTranscript: string;
  agentClaims: ExecutionAgentClaims;
  linearIssueBody: string;
  planContent: string | undefined; // @allow-undefined-type -- callers always provide the key, value may be undefined
}

export interface ExecutionDeepValidator {
  validate(input: DeepValidationInput, onProgress?: (message: string) => void): Promise<boolean>;
}

export class OrchestratorExecutionDeepValidator implements ExecutionDeepValidator {
  private readonly llmClient: LlmGenerateClient;
  private readonly model: Gemini25Flash;

  constructor(
    private readonly logger: Logger,
    config: ExecutionDeepValidatorConfig
  ) {
    this.model = config.model;
    this.llmClient = this.createLlmClient(config);
  }

  async validate(
    input: DeepValidationInput,
    onProgress?: (message: string) => void
  ): Promise<boolean> {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: input.formattedTranscript,
      agentClaims: input.agentClaims,
      linearIssueBody: input.linearIssueBody,
      planContent: input.planContent,
    });

    this.logger.info(
      { taskId: input.taskId, promptChars: prompt.length, model: this.model },
      'Deep validation LLM request'
    );

    onProgress?.('calling Gemini for analysis...');

    const generated = await this.llmClient.generate(prompt);
    if (!generated.ok) {
      this.logger.error(
        {
          taskId: input.taskId,
          errorCode: generated.error.code,
          errorMessage: generated.error.message,
        },
        'Deep validation LLM call failed'
      );
      onProgress?.(`LLM call failed: ${generated.error.message}`);
      return false;
    }

    this.logger.info(
      { taskId: input.taskId, responseChars: generated.value.content.length },
      'Deep validation LLM response received'
    );

    onProgress?.('validation response received');

    const sanitized = sanitizeMarkdownResponse(generated.value.content);
    if (sanitized === '') {
      this.logger.warn(
        { taskId: input.taskId },
        'Deep validation response empty after sanitization'
      );
      onProgress?.('response empty after sanitization, skipping PR comment');
      return false;
    }

    onProgress?.('posting PR comment...');
    const posted = await this.postPrComment(input, sanitized, generated.value.usage.costUsd);
    onProgress?.(posted ? 'PR comment posted' : 'PR comment failed (see server logs)');
    return posted;
  }

  private async postPrComment(
    input: DeepValidationInput,
    markdownBody: string,
    costUsd: number
  ): Promise<boolean> {
    const comment = buildPrComment(markdownBody, costUsd);
    try {
      await execFileAsync(
        'gh',
        ['pr', 'comment', String(input.prNumber), '--repo', input.repository, '--body', comment],
        {}
      );
      this.logger.info(
        { taskId: input.taskId, prNumber: input.prNumber },
        'Deep validation PR comment posted'
      );
      return true;
    } catch (error) {
      /* v8 ignore start -- upstream: stderr property only exists on execFile errors, not testable with promisify mock @preserve */
      const stderr =
        error instanceof Error && 'stderr' in error
          ? String((error as Record<string, unknown>)['stderr'])
          : undefined;
      /* v8 ignore stop @preserve */
      this.logger.error(
        { taskId: input.taskId, error: getErrorMessage(error), stderr },
        'Failed to post deep validation PR comment'
      );
      return false;
    }
  }

  private createLlmClient(config: ExecutionDeepValidatorConfig): LlmGenerateClient {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard for type safety at API boundary
    if (config.model !== LlmModels.Gemini25Flash) {
      throw new Error('Deep validator must use model gemini-2.5-flash');
    }
    const pricing = DEEP_VALIDATOR_PRICING[config.model];
    /* v8 ignore start -- upstream: model guard above guarantees Gemini pricing entry exists @preserve */
    if (pricing === undefined) {
      throw new Error(`Missing deep validator pricing for model: ${config.model}`);
    }
    /* v8 ignore stop @preserve */
    if (config.geminiApiKey === '') {
      throw new Error('INTEXURAOS_GEMINI_APP_API_KEY is required for deep validator');
    }
    if (config.auditLogPath === '') {
      throw new Error('Deep validator auditLogPath is required');
    }
    return createLlmClient({
      apiKey: config.geminiApiKey,
      model: config.model,
      userId: 'orchestrator-deep-validator',
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

function buildPrComment(markdownBody: string, costUsd: number): string {
  return ['### Deep Validation Report', '', `**Cost:** $${String(costUsd)}`, '', markdownBody].join(
    '\n'
  );
}

function sanitizeMarkdownResponse(content: string): string {
  const trimmed = unwrapCodeFence(content).trim();
  if (trimmed === '') return '';
  if (trimmed.length <= MAX_MARKDOWN_RESPONSE_CHARS) return trimmed;

  const maxBodyLength = MAX_MARKDOWN_RESPONSE_CHARS - TRUNCATED_MARKDOWN_MARKER.length;
  return trimmed.slice(0, maxBodyLength) + TRUNCATED_MARKDOWN_MARKER;
}

function unwrapCodeFence(content: string): string {
  const trimmed = content.trim();
  const match = /^```(?:[A-Za-z0-9_-]+)?\s*\n?([\s\S]*?)\n?\s*```$/u.exec(trimmed);
  return match?.[1] ?? trimmed;
}
