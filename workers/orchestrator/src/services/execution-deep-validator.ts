import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  LlmModels,
  type Gemini25Flash,
  type LLMModel,
  type ModelPricing,
} from '@intexuraos/llm-contract';
import { StructuredLogUsageSink } from '@intexuraos/llm-pricing';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecutionAgentData } from './completion-verifier.js';
import { OrchestratorFileAuditSink } from './orchestrator-audit-sink.js';

const execFileAsync = promisify(execFile);

// --- Constants ---

export const DEEP_VALIDATION_PROMPT_VERSION = '2.1.0';

/** Maximum transcript characters to send to LLM. Gemini 2.5 Flash supports ~1M tokens
 *  but we cap to keep cost/latency reasonable for deep validation. */
const MAX_TRANSCRIPT_CHARS = 200_000;

// --- Zod Schema ---

const claimVerificationItem = z.object({
  claim: z.string(),
  verdict: z.enum(['verified', 'contradicted', 'unverifiable']),
  evidence: z.string(),
});

const contractVerificationItem = z.object({
  obligation: z.string(),
  verdict: z.enum(['fulfilled', 'violated', 'not_applicable']),
  evidence: z.string(),
});

const requirementItem = z.object({
  requirement: z.string(),
  verdict: z.enum(['implemented', 'partially', 'missing']),
  evidence: z.string(),
});

const anomalyItem = z.object({
  type: z.enum(['fabrication', 'ignored_error', 'laziness', 'skipped_step']),
  severity: z.enum(['critical', 'warning', 'info']),
  evidence: z.string(),
  detail: z.string(),
});

export const DEEP_VALIDATION_SCHEMA = z.object({
  claimVerification: z.array(claimVerificationItem),
  contractVerification: z.array(contractVerificationItem),
  planVsReality: z.object({
    planFound: z.boolean(),
    requirements: z.array(requirementItem),
  }),
  anomalies: z.array(anomalyItem),
});

export type DeepValidationResult = z.infer<typeof DEEP_VALIDATION_SCHEMA>;

export type ExecutionAgentClaims = Omit<ExecutionAgentData, 'agentType'>;

// --- Prompt Builder ---

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
      ? `Plan file content:\n${input.planContent}`
      : 'No plan file found on branch.';

  // Cap transcript to avoid exceeding LLM context / cost limits
  const transcript =
    input.formattedTranscript.length > MAX_TRANSCRIPT_CHARS
      ? input.formattedTranscript.slice(0, MAX_TRANSCRIPT_CHARS) +
        `\n\n[TRANSCRIPT TRUNCATED at ${String(MAX_TRANSCRIPT_CHARS)} chars — ${String(input.formattedTranscript.length)} total]`
      : input.formattedTranscript;

  return [
    `[deep-validation-prompt v${DEEP_VALIDATION_PROMPT_VERSION}]`,
    'You are a post-execution validator for an autonomous coding agent.',
    'Analyze the full session transcript below and answer three groups of questions.',
    'Return ONLY a JSON object matching the schema described. No markdown fences.',
    '',
    '=== Section 1: Claim Verification ===',
    'The agent made these claims in its final report:',
    claimsJson,
    '',
    'For EACH claim, find supporting or contradicting evidence in the transcript.',
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
    '- For requesting-code-review: was the core instruction (dispatch subagent) actually followed through?',
    '- Were there any skills loaded whose instructions were not followed?',
    '',
    '=== Section 3: Plan vs Reality ===',
    `Linear issue requirements:\n${input.linearIssueBody}`,
    '',
    planSection,
    '',
    'Map each requirement from the Linear issue (and plan if present) to evidence in the transcript.',
    'Which requirements were addressed by tool calls (file edits, tests written)?',
    'Which were missed or only partially addressed?',
    '',
    '=== Anomalies ===',
    'Additionally, report any anomalies you notice:',
    '- Errors that were encountered then silently ignored (tool_result with error, agent proceeds as if success)',
    '- Laziness patterns (skipping steps, simplifying instead of following instructions)',
    '- Fabrication (agent claims something happened that transcript contradicts)',
    '- Any tool call that returned an error and the agent drew wrong conclusions from it',
    '',
    'For EVERY finding, include the specific MSG-NNN reference from the transcript.',
    '',
    '=== Response Schema ===',
    '{',
    '  "claimVerification": [{ "claim": "string", "verdict": "verified|contradicted|unverifiable", "evidence": "MSG-NNN: detail" }],',
    '  "contractVerification": [{ "obligation": "string", "verdict": "fulfilled|violated|not_applicable", "evidence": "MSG-NNN: detail" }],',
    '  "planVsReality": {',
    '    "planFound": true|false,',
    '    "requirements": [{ "requirement": "string", "verdict": "implemented|partially|missing", "evidence": "MSG-NNN: detail" }]',
    '  },',
    '  "anomalies": [{ "type": "fabrication|ignored_error|laziness|skipped_step", "severity": "critical|warning|info", "evidence": "MSG-NNN: detail", "detail": "explanation" }]',
    '}',
    '',
    '=== Full Session Transcript ===',
    transcript,
  ].join('\n');
}

// --- PR Comment Formatter ---

function verdictEmoji(
  verdict:
    | 'verified'
    | 'contradicted'
    | 'unverifiable'
    | 'fulfilled'
    | 'violated'
    | 'not_applicable'
    | 'implemented'
    | 'partially'
    | 'missing'
): string {
  if (verdict === 'verified' || verdict === 'fulfilled' || verdict === 'implemented') return '✅';
  if (verdict === 'contradicted' || verdict === 'violated' || verdict === 'missing') return '❌';
  if (verdict === 'partially') return '⚠️';
  return '❓';
}

function severityEmoji(severity: 'critical' | 'warning' | 'info'): string {
  if (severity === 'critical') return '🔴';
  if (severity === 'warning') return '🟡';
  return '🔵';
}

export function formatPrComment(result: DeepValidationResult): string {
  const lines: string[] = ['### Deep Validation Report', ''];

  // Section 1
  lines.push('#### Claim Verification');
  if (result.claimVerification.length === 0) {
    lines.push('No claims verified.');
  } else {
    lines.push('| Claim | Verdict | Evidence |');
    lines.push('|-------|---------|----------|');
    for (const item of result.claimVerification) {
      lines.push(
        `| ${item.claim} | ${verdictEmoji(item.verdict)} ${item.verdict} | ${item.evidence} |`
      );
    }
  }
  lines.push('');

  // Section 2
  lines.push('#### Contract Verification');
  if (result.contractVerification.length === 0) {
    lines.push('No contracts verified.');
  } else {
    lines.push('| Obligation | Verdict | Evidence |');
    lines.push('|------------|---------|----------|');
    for (const item of result.contractVerification) {
      lines.push(
        `| ${item.obligation} | ${verdictEmoji(item.verdict)} ${item.verdict} | ${item.evidence} |`
      );
    }
  }
  lines.push('');

  // Section 3
  lines.push('#### Plan vs Reality');
  lines.push(
    `Plan found: ${result.planVsReality.planFound ? '✅' : '❌ No plan file found on branch'}`
  );
  if (result.planVsReality.requirements.length > 0) {
    lines.push('');
    lines.push('| Requirement | Verdict | Evidence |');
    lines.push('|-------------|---------|----------|');
    for (const item of result.planVsReality.requirements) {
      lines.push(
        `| ${item.requirement} | ${verdictEmoji(item.verdict)} ${item.verdict} | ${item.evidence} |`
      );
    }
  }
  lines.push('');

  // Anomalies
  if (result.anomalies.length > 0) {
    lines.push('#### Anomalies');
    lines.push('| Type | Severity | Evidence | Detail |');
    lines.push('|------|----------|----------|--------|');
    for (const item of result.anomalies) {
      lines.push(
        `| ${item.type} | ${severityEmoji(item.severity)} ${item.severity} | ${item.evidence} | ${item.detail} |`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Main Service ---

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
  validate(
    input: DeepValidationInput,
    onProgress?: (message: string) => void
  ): Promise<DeepValidationResult | undefined>;
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
  ): Promise<DeepValidationResult | undefined> {
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
      return undefined;
    }

    this.logger.info(
      { taskId: input.taskId, responseChars: generated.value.content.length },
      'Deep validation LLM response received'
    );

    onProgress?.('validation response received');

    let rawJson: unknown;
    try {
      rawJson = extractJson(generated.value.content);
    } catch (error) {
      this.logger.error(
        { taskId: input.taskId, error: getErrorMessage(error), response: generated.value.content },
        'Deep validation JSON parse failed'
      );
      onProgress?.(`JSON parse failed: ${getErrorMessage(error)}`);
      return undefined;
    }

    const parseResult = DEEP_VALIDATION_SCHEMA.safeParse(rawJson);
    if (!parseResult.success) {
      this.logger.warn(
        { taskId: input.taskId, zodErrors: parseResult.error.issues },
        'Deep validation Zod validation failed — posting raw response as fallback'
      );
      onProgress?.('schema parse failed, posting raw response as fallback');
      // Fallback: post raw LLM response when schema parse fails
      await this.postRawComment(input, generated.value.content);
      return undefined;
    }

    const result = parseResult.data;

    // Post PR comment
    onProgress?.('posting PR comment...');
    const posted = await this.postPrComment(input, result);
    onProgress?.(posted ? 'PR comment posted' : 'PR comment failed (see server logs)');

    return result;
  }

  private async postPrComment(
    input: DeepValidationInput,
    result: DeepValidationResult
  ): Promise<boolean> {
    const comment = formatPrComment(result);
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

  private async postRawComment(input: DeepValidationInput, rawResponse: string): Promise<void> {
    const comment = [
      '### Deep Validation Report (raw — schema parse failed)',
      '',
      '```json',
      rawResponse.slice(0, 3000),
      '```',
    ].join('\n');
    try {
      await execFileAsync(
        'gh',
        ['pr', 'comment', String(input.prNumber), '--repo', input.repository, '--body', comment],
        {}
      );
    } catch (error) {
      /* v8 ignore start -- upstream: stderr property only exists on execFile errors, not testable with promisify mock @preserve */
      const stderr =
        error instanceof Error && 'stderr' in error
          ? String((error as Record<string, unknown>)['stderr'])
          : undefined;
      /* v8 ignore stop @preserve */
      this.logger.error(
        { taskId: input.taskId, error: getErrorMessage(error), stderr },
        'Failed to post raw deep validation PR comment'
      );
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

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return JSON.parse(trimmed) as unknown;
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
  }
  throw new Error('Deep validator response is not valid JSON');
}
