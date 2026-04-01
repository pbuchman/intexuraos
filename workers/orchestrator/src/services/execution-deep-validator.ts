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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ExecutionAgentData } from './completion-verifier.js';
import { OrchestratorFileAuditSink } from './orchestrator-audit-sink.js';

const execFileAsync = promisify(execFile);

export const DEEP_VALIDATION_PROMPT_VERSION = '5.3.0';

const MAX_TRANSCRIPT_CHARS = 200_000;
const GITHUB_COMMENT_MAX_CHARS = 65_536;
const GITHUB_COMMENT_SAFETY_MARGIN_CHARS = 512;
const SAFE_GITHUB_COMMENT_MAX_CHARS = GITHUB_COMMENT_MAX_CHARS - GITHUB_COMMENT_SAFETY_MARGIN_CHARS;
const TEMP_COMMENT_DIR_PREFIX = 'orchestrator-deep-validation-';
const SEVERITY_SCALE = [
  '🔴 Critical — Blocking issue, fabricated evidence, or complete contract violation',
  '🟠 Warning — Partial compliance, missed requirement, or ignored error',
  '🟡 Minor — Non-blocking observation, minor deviation, or style concern',
  '🟢 Pass — Verified, compliant, no issues found',
] as const;

const REQUIRED_SECTION_HEADINGS = [
  '#### Overall',
  '#### Claim Verification',
  '#### Contract Verification',
  '#### Plan vs Reality',
  '#### Anomalies',
] as const;
const LIST_LINE_REGEX = /^\s*(?:[-*+]\s+|\d+\.\s+)/mu;
const MARKDOWN_TABLE_SEPARATOR_REGEX = /^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/u;

export type ExecutionAgentClaims = Omit<ExecutionAgentData, 'agentType'>;
type RequiredSectionHeading = (typeof REQUIRED_SECTION_HEADINGS)[number];
type NonEmptyArray<T> = [T, ...T[]];

export interface DeepValidationPromptInput {
  formattedTranscript: string;
  agentClaims: ExecutionAgentClaims;
  linearIssueBody: string;
  planContent: string | undefined; // @allow-undefined-type -- callers always provide the key, value may be undefined
  workerType: string;
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
    'You are a post-execution validator for the IntexuraOS Agent-Based Code Task Execution Flow.',
    'Analyze the full session transcript below and write a concise Deep Validation Report for human review on the PR.',
    'Return ONLY markdown.',
    'Return the report explicitly as markdown tables.',
    'Do not return bullet lists, numbered lists, JSON, or code fences.',
    'Do not return a list anywhere in the response.',
    'Use these headings exactly and in this order:',
    ...REQUIRED_SECTION_HEADINGS,
    'Under each heading, include exactly one markdown table.',
    'If a section has nothing noteworthy, include a single table row that says None.',
    'Be concise. Preserve all warnings, failures, contradictions, and anomalies, but summarize what went well instead of exhaustively listing positive details.',
    'Keep each section compact enough to fit in a GitHub PR comment as a complete table.',
    '',
    '=== Severity Scale ===',
    'Use ONLY these severity levels in the Result or Severity column of every table row.',
    'Do not invent your own severity levels. Use the emoji prefix exactly as shown:',
    ...SEVERITY_SCALE,
    '',
    '=== Section 1: Claim Verification ===',
    'The agent made these claims in its final report:',
    claimsJson,
    '',
    'For each claim, confirm or contradict it with transcript evidence.',
    'Specifically check:',
    '- Was pnpm run ci:tracked called? What was the exit code in the tool_result?',
    '- Was superpowers:requesting-code-review explicitly invoked? After that point, is there transcript evidence of a review worker/subagent/reviewer loop?',
    '- Was superpowers:subagent-driven-development explicitly invoked?',
    '- Was a PR created via gh pr create? What URL was returned?',
    '- How many successful local commits are evidenced in the transcript?',
    '',
    '=== Section 2: Contract Verification ===',
    'The execution system prompt mandates this skill sequence:',
    '1. superpowers:subagent-driven-development must be invoked first',
    '2. superpowers:requesting-code-review must be invoked second',
    '3. After requesting-code-review is loaded, the agent MUST show transcript evidence of a review worker/subagent/reviewer dispatch or equivalent explicit review loop',
    '',
    'Check:',
    '- Was each mandatory skill loaded? In what order?',
    '- For requesting-code-review: was the core instruction actually followed through?',
    '- Were there any skills loaded whose instructions were not followed?',
    ...(input.workerType.startsWith('codex')
      ? [
          '- For Codex transcripts, were the startup evidence lines present: `[entrypoint] Bootstrap evidence:` and `[entrypoint] Codex runtime evidence:`?',
          '- Treat missing startup evidence lines as a warning because retained Codex parity proof is absent.',
        ]
      : []),
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
  workerType: string;
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
      workerType: input.workerType,
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

    const reportSections = parseMarkdownReport(sanitized);
    if (!reportSections.ok) {
      this.logger.warn(
        { taskId: input.taskId, reason: reportSections.reason },
        'Deep validation response rejected'
      );
      onProgress?.(`response rejected: ${reportSections.reason}, skipping PR comment`);
      return false;
    }

    const commentBodies = buildCommentBodies(reportSections.value, generated.value.usage.costUsd);
    if (!commentBodies.ok) {
      this.logger.warn(
        { taskId: input.taskId, reason: commentBodies.reason },
        'Deep validation response rejected'
      );
      onProgress?.(`response rejected: ${commentBodies.reason}, skipping PR comment`);
      return false;
    }

    onProgress?.('posting PR comment...');
    const posted = await this.postPrComments(input, commentBodies.value);
    onProgress?.(posted ? 'PR comment posted' : 'PR comment failed (see server logs)');
    return posted;
  }

  private async postPrComments(
    input: DeepValidationInput,
    commentBodies: readonly string[]
  ): Promise<boolean> {
    const tempDirectory = await mkdtemp(join(tmpdir(), TEMP_COMMENT_DIR_PREFIX));
    try {
      for (const [index, body] of commentBodies.entries()) {
        const bodyFilePath = join(tempDirectory, `comment-${String(index + 1)}.md`);
        await writeFile(bodyFilePath, body, 'utf8');
        await execFileAsync(
          'gh',
          [
            'pr',
            'comment',
            String(input.prNumber),
            '--repo',
            input.repository,
            '--body-file',
            bodyFilePath,
          ],
          {}
        );
      }
      this.logger.info(
        { taskId: input.taskId, prNumber: input.prNumber, commentCount: commentBodies.length },
        'Deep validation PR comment posted'
      );
      return true;
    } catch (error) {
      const stderr =
        error instanceof Error && 'stderr' in error
          ? String((error as Record<string, unknown>)['stderr'])
          : undefined;
      this.logger.error(
        { taskId: input.taskId, error: getErrorMessage(error), stderr },
        'Failed to post deep validation PR comment'
      );
      return false;
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }

  private createLlmClient(config: ExecutionDeepValidatorConfig): LlmGenerateClient {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard for type safety at API boundary
    if (config.model !== LlmModels.Gemini25Flash) {
      throw new Error('Deep validator must use model gemini-2.5-flash');
    }
    const pricing = DEEP_VALIDATOR_PRICING[config.model];
    /* v8 ignore start -- upstream: model guard above guarantees pricing entry exists @preserve */
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

function buildPrComment(
  sectionBlocks: readonly string[],
  costUsd: number,
  partNumber: number,
  totalParts: number
): string {
  const title =
    totalParts === 1
      ? '### Deep Validation Report — IntexuraOS Agent-Based Code Task Execution Flow'
      : `### Deep Validation Report (Part ${String(partNumber)}/${String(totalParts)}) — IntexuraOS Agent-Based Code Task Execution Flow`;
  const lines = ['@ignore', '', title, ''];

  if (partNumber === 1) {
    lines.push(`**Cost:** $${String(costUsd)}`, '');
  }

  lines.push(sectionBlocks.join('\n\n'));
  return lines.join('\n');
}

function sanitizeMarkdownResponse(content: string): string {
  return unwrapCodeFence(content).trim();
}

function unwrapCodeFence(content: string): string {
  const trimmed = content.trim();
  const match = /^```(?:[A-Za-z0-9_-]+)?\s*\n?([\s\S]*?)\n?\s*```$/u.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function parseMarkdownReport(
  markdownBody: string
): { ok: true; value: NonEmptyArray<string> } | { ok: false; reason: string } {
  if (LIST_LINE_REGEX.test(markdownBody)) {
    return {
      ok: false,
      reason: 'contains bullet lists or numbered lists; expected markdown tables only',
    };
  }

  const sectionBlocks = splitIntoSectionBlocks(markdownBody);
  if (!sectionBlocks.ok) {
    return sectionBlocks;
  }

  for (const sectionBlock of sectionBlocks.value) {
    const validation = validateSectionBlock(sectionBlock);
    if (!validation.ok) {
      return validation;
    }
  }

  return { ok: true, value: sectionBlocks.value };
}

function splitIntoSectionBlocks(
  markdownBody: string
): { ok: true; value: NonEmptyArray<string> } | { ok: false; reason: string } {
  const lines = markdownBody.split('\n');
  const sections: string[] = [];
  let currentSectionStart: number | undefined;
  let currentHeadingIndex = 0;

  for (const [lineIndex, line] of lines.entries()) {
    const trimmed = line.trim();
    const expectedHeading = REQUIRED_SECTION_HEADINGS[currentHeadingIndex];

    if (expectedHeading !== undefined && trimmed === expectedHeading) {
      if (currentSectionStart !== undefined) {
        sections.push(trimSectionBlock(lines.slice(currentSectionStart, lineIndex)));
      } else if (lineIndex > 0) {
        return {
          ok: false,
          reason: 'report must start with the required headings and contain no preamble',
        };
      }

      currentSectionStart = lineIndex;
      currentHeadingIndex += 1;
      continue;
    }

    if (isRequiredSectionHeading(trimmed)) {
      return {
        ok: false,
        reason: 'missing required headings or headings are out of order',
      };
    }
  }

  if (
    currentSectionStart === undefined ||
    currentHeadingIndex !== REQUIRED_SECTION_HEADINGS.length
  ) {
    return {
      ok: false,
      reason: 'missing required headings or headings are out of order',
    };
  }

  sections.push(trimSectionBlock(lines.slice(currentSectionStart)));
  return { ok: true, value: sections as NonEmptyArray<string> };
}

function validateSectionBlock(sectionBlock: string): { ok: true } | { ok: false; reason: string } {
  const bodyLines = sectionBlock
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '');

  if (bodyLines.length < 3) {
    return {
      ok: false,
      reason: 'each section must contain exactly one markdown table with at least one data row',
    };
  }

  const allTableLines = bodyLines.every((line) => line.trim().startsWith('|'));
  if (!allTableLines) {
    return {
      ok: false,
      reason: 'each section must contain exactly one markdown table and no list or prose lines',
    };
  }

  const separatorLine = bodyLines.slice(1, 2).join('').trim();
  if (!MARKDOWN_TABLE_SEPARATOR_REGEX.test(separatorLine)) {
    return {
      ok: false,
      reason: 'each section must contain exactly one markdown table with a header separator row',
    };
  }

  return { ok: true };
}

function buildCommentBodies(
  sectionBlocks: NonEmptyArray<string>,
  costUsd: number
): { ok: true; value: string[] } | { ok: false; reason: string } {
  const plannedParts: string[][] = [];
  let currentPart: string[] = [];

  for (const sectionBlock of sectionBlocks) {
    const candidatePart = [...currentPart, sectionBlock];
    const partIndex = plannedParts.length + 1;
    const candidateComment = buildPrComment(
      candidatePart,
      costUsd,
      partIndex,
      REQUIRED_SECTION_HEADINGS.length
    );

    if (candidateComment.length <= SAFE_GITHUB_COMMENT_MAX_CHARS) {
      currentPart = candidatePart;
      continue;
    }

    if (currentPart.length === 0) {
      return {
        ok: false,
        reason: 'single section exceeds GitHub comment limit; Gemini must be more concise',
      };
    }

    plannedParts.push(currentPart);
    currentPart = [sectionBlock];

    const singleSectionComment = buildPrComment(
      currentPart,
      costUsd,
      plannedParts.length + 1,
      REQUIRED_SECTION_HEADINGS.length
    );
    if (singleSectionComment.length > SAFE_GITHUB_COMMENT_MAX_CHARS) {
      return {
        ok: false,
        reason: 'single section exceeds GitHub comment limit; Gemini must be more concise',
      };
    }
  }

  plannedParts.push(currentPart);

  const totalParts = plannedParts.length;
  const comments = plannedParts.map((sectionGroup, index) =>
    buildPrComment(sectionGroup, costUsd, index + 1, totalParts)
  );

  return { ok: true, value: comments };
}

function trimSectionBlock(lines: readonly string[]): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1]?.trim() === '') {
    end -= 1;
  }
  return lines.slice(0, end).join('\n');
}

function isRequiredSectionHeading(value: string): value is RequiredSectionHeading {
  return REQUIRED_SECTION_HEADINGS.includes(value as RequiredSectionHeading);
}
