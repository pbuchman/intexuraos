import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import { LlmModels, type LLMModel, type ModelPricing } from '@intexuraos/llm-contract';
import { StructuredLogUsageSink } from '@intexuraos/llm-pricing';
import { z } from 'zod';
import { stripDockerHeaders } from './log-formatter.js';
import { OrchestratorFileAuditSink } from './orchestrator-audit-sink.js';

export type CompletionAgentType = 'planning' | 'execution' | 'pull_request' | 'review';

export interface CompletionVerifierInput {
  taskId: string;
  attempt: number;
  maxAttempts: number;
  agentType: CompletionAgentType;
  rawLogs: string;
}

export interface CompletionVerifierTrace {
  transcript: string;
  prompt: string;
  response: string;
}

export interface CompletionVerifierVerdict {
  /** True when Gemini extraction succeeded and all Zod fields were present — does NOT mean the agent completed its task. */
  passed: boolean;
  missingFields: string[];
  verifierFailure: boolean;
  agentData?: PlanningAgentData | ExecutionAgentData | PullRequestAgentData | ReviewAgentData;
  trace: CompletionVerifierTrace;
}

export interface PlanningAgentData {
  agentType: 'planning';
  outcome: 'planned' | 'unclear';
  superpowers_writing_plans: 'used' | 'not used';
  linear_url: string;
  is_complex: '0' | '1';
  subtask_urls: string;
  pr_url: string;
  summary: string;
  unclear_clarification: string;
}

export interface ExecutionAgentData {
  agentType: 'execution';
  outcome: 'implemented' | 'already_completed';
  superpowers_executing_plans: 'used' | 'not used';
  superpowers_requesting_code_review: 'used' | 'not used';
  gh_pr_url: string;
  summary: string;
}

export interface PullRequestAgentData {
  agentType: 'pull_request';
  gh_pr_url: string;
  comments_replied: 'yes' | 'no';
  tracking_comment_id: string;
  summary: string;
}

export interface ReviewAgentData {
  agentType: 'review';
  gh_pr_url: string;
  review_comments_posted: string;
  review_types: string;
  requirements_tracker_updated?: string;
  summary: string;
}

export interface CompletionVerifier {
  verify(input: CompletionVerifierInput): Promise<CompletionVerifierVerdict>;
  describe(): { enabled: boolean; provider?: string; model?: string };
  extractResumeSummary(taskId: string, rawLogs: string): Promise<string | undefined>;
}

export interface CompletionVerifierConfig {
  model: string;
  geminiApiKey: string;
  auditLogPath: string;
}

export const PLANNING_SCHEMA = z.object({
  outcome: z.enum(['planned', 'unclear']),
  superpowers_writing_plans: z.enum(['used', 'not used']),
  linear_url: z.string(),
  is_complex: z.enum(['0', '1']),
  subtask_urls: z.string(),
  pr_url: z.string(),
  summary: z.string(),
  unclear_clarification: z.string(),
});

export const EXECUTION_SCHEMA = z.object({
  outcome: z.enum(['implemented', 'already_completed']),
  superpowers_executing_plans: z.enum(['used', 'not used']),
  superpowers_requesting_code_review: z.enum(['used', 'not used']),
  gh_pr_url: z.string(),
  summary: z.string(),
});

export const PULL_REQUEST_SCHEMA = z.object({
  gh_pr_url: z.string(),
  comments_replied: z.enum(['yes', 'no']),
  tracking_comment_id: z.string().min(1),
  summary: z.string(),
});

export const REVIEW_SCHEMA = z.object({
  gh_pr_url: z.string(),
  review_comments_posted: z
    .string()
    .regex(/^\d+$/, 'review_comments_posted must be a numeric string'),
  review_types: z.string().trim().min(1, 'review_types must not be empty'),
  requirements_tracker_updated: z.string().optional().default(''),
  summary: z.string(),
});

export const RESUME_SUMMARY_SCHEMA = z.object({
  summary: z.string(),
});

const VERIFIER_PRICING: Partial<Record<LLMModel, ModelPricing>> = {
  [LlmModels.Gemini25Flash]: {
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
    groundingCostPerRequest: 0,
  },
};

const FATAL_EXIT_CODE_PATTERN = /\[entrypoint\] Claude attempt finished with exit code: (137|139)/;

export function detectFatalExitCode(rawLogs: string): number | undefined {
  const match = FATAL_EXIT_CODE_PATTERN.exec(rawLogs);
  if (match?.[1] !== undefined) {
    return Number(match[1]);
  }
  return undefined;
}

export function getLast50Lines(rawLogs: string): string {
  return stripDockerHeaders(rawLogs).split('\n').slice(-50).join('\n');
}

export function getLast20Lines(rawLogs: string): string {
  return stripDockerHeaders(rawLogs).split('\n').slice(-20).join('\n');
}

function sharedPreamble(): string[] {
  return [
    'IMPORTANT RULES:',
    '- Analyze the transcript from the END toward the beginning. The most recent output takes priority — e.g. pnpm run ci:tracked may have failed and then succeeded; the expected result is the final outcome.',
    '- The LLM agent delivers its summary in one of the last assistant messages.',
    '- superpowers_writing_plans: "used" only if the agent explicitly claims it invoked the writing-plans superpowers skill.',
    '- Sample Linear URL format: https://linear.app/pbuchman/issue/INT-631/feature-introduce-github-webhook-agent-ownership-orchestration',
    '- Sample PR URL format: https://github.com/pbuchman/intexuraos/pull/944',
    '',
  ];
}

export function buildPlanningPrompt(transcript: string): string {
  return [
    'You are a task-completion verifier for the Planning Agent.',
    'Analyze the transcript below and extract the following fields as JSON.',
    'Return ONLY a JSON object, no markdown fences.',
    '',
    ...sharedPreamble(),
    'Fields:',
    '- outcome: "planned" if the agent produced a plan, "unclear" if the agent could not plan',
    '- superpowers_writing_plans: "used" if the agent invoked the writing-plans skill, "not used" otherwise',
    '- linear_url: the Linear issue URL — the single issue the agent received as input and edited in-place (string, empty string if not found)',
    '- is_complex: "1" if the agent created subtasks for parallel execution, "0" otherwise',
    '- subtask_urls: comma-separated Linear issue URLs for all subtasks created (string, empty string if none)',
    '- pr_url: the GitHub Pull Request URL if the agent created one (string, empty string if not found)',
    '- summary: 3-5 sentence summary of what happened — the LLM agent typically states this clearly as a summary block in its final output',
    '- unclear_clarification: required when outcome is "unclear" — the message explaining why; empty string if outcome is "planned"',
    '',
    'Example valid response:',
    '{"outcome":"planned","superpowers_writing_plans":"used","linear_url":"https://linear.app/pbuchman/issue/INT-631/feature-introduce-github-webhook-agent-ownership-orchestration","is_complex":"1","subtask_urls":"https://linear.app/pbuchman/issue/INT-632/subtask-one,https://linear.app/pbuchman/issue/INT-633/subtask-two","pr_url":"https://github.com/pbuchman/intexuraos/pull/944","summary":"The planning agent analyzed the task requirements and created a detailed implementation plan with 5 child issues. The plan covers API endpoints, database schema, and test strategy.","unclear_clarification":""}',
    '',
    'Transcript (last 50 lines):',
    transcript,
  ].join('\n');
}

export function buildExecutionPrompt(transcript: string): string {
  return [
    'You are a task-completion verifier for the Execution Agent.',
    'Analyze the transcript below and extract the following fields as JSON.',
    'Return ONLY a JSON object, no markdown fences.',
    '',
    ...sharedPreamble(),
    'Fields:',
    '- outcome: "implemented" if the agent created a PR with new code, "already_completed" if the agent determined the work was already done/merged',
    '- superpowers_executing_plans: "used" if the agent invoked the executing-plans skill, "not used" otherwise',
    '- superpowers_requesting_code_review: "used" if the agent invoked the requesting-code-review skill, "not used" otherwise',
    '- gh_pr_url: the GitHub Pull Request URL (string, empty string if not found)',
    '- summary: 3-5 sentence summary of what was implemented — the LLM agent typically states this clearly as a summary block in its final output',
    '',
    'Example valid responses:',
    '{"outcome":"implemented","superpowers_executing_plans":"used","superpowers_requesting_code_review":"used","gh_pr_url":"https://github.com/pbuchman/intexuraos/pull/901","summary":"The execution agent implemented the feature as planned, adding 3 new API endpoints and updating the database schema. CI passed on the first attempt. A PR was created targeting the development branch."}',
    '{"outcome":"already_completed","superpowers_executing_plans":"used","superpowers_requesting_code_review":"not used","gh_pr_url":"","summary":"The agent discovered that the requested work was already implemented and merged into the development branch. All tests pass and the feature is present in the codebase. No PR was needed."}',
    '',
    'Transcript (last 50 lines):',
    transcript,
  ].join('\n');
}

export function buildPullRequestPrompt(transcript: string): string {
  return [
    'You are a task-completion verifier for the Pull Request Agent.',
    'Analyze the transcript below and extract the following fields as JSON.',
    'Return ONLY a JSON object, no markdown fences.',
    '',
    ...sharedPreamble(),
    'Fields:',
    '- gh_pr_url: the GitHub Pull Request URL (string, empty string if not found)',
    '- comments_replied: "yes" if the agent replied to PR comments, "no" otherwise',
    '- tracking_comment_id: the numeric GitHub comment ID from the tracking comment POST response (string, must not be empty)',
    '- summary: 3-5 sentence summary of what was done — the LLM agent typically states this clearly as a summary block in its final output',
    '',
    'Example valid response:',
    '{"gh_pr_url":"https://github.com/pbuchman/intexuraos/pull/901","comments_replied":"yes","tracking_comment_id":"2345678","summary":"The pull request agent addressed 3 review comments on PR #901. Code changes were pushed and CI passed. All reviewer feedback was resolved."}',
    '',
    'Transcript (last 50 lines):',
    transcript,
  ].join('\n');
}

export function buildReviewPrompt(transcript: string): string {
  return [
    'You are a task-completion verifier for the Review Agent.',
    'Analyze the transcript below and extract the following fields as JSON.',
    'Return ONLY a JSON object, no markdown fences.',
    '',
    ...sharedPreamble(),
    'Fields:',
    '- gh_pr_url: the GitHub Pull Request URL (string, empty string if not found)',
    '- review_comments_posted: number of review comments posted as a string (e.g., "3")',
    '- review_types: comma-separated list of review types performed (e.g., "code_quality,security")',
    '- requirements_tracker_updated: "yes" if tracker comment was created/updated, "no" if skipped, empty string if no requirements available',
    '- summary: 3-5 sentence summary of the review findings — the LLM agent typically states this clearly as a summary block in its final output',
    '',
    'Example valid response:',
    '{"gh_pr_url":"https://github.com/pbuchman/intexuraos/pull/901","review_comments_posted":"3","review_types":"code_quality,security","requirements_tracker_updated":"yes","summary":"The review agent analyzed PR #901 for code quality and security issues. Found 3 issues: a missing null check, an unused import, and a potential XSS vulnerability. All findings were posted as inline review comments."}',
    '',
    'Transcript (last 50 lines):',
    transcript,
  ].join('\n');
}

export function buildResumeSummaryPrompt(transcript: string): string {
  return [
    'You are summarizing the output of a resumed Claude coding session.',
    'Analyze the transcript below and extract a brief summary of what was accomplished.',
    'Return ONLY a JSON object with a single field, no markdown fences.',
    '',
    'Rules:',
    '- Find the summary Claude stated directly in the last assistant messages.',
    '- If no explicit summary exists, write 2-3 sentences describing the last completed action.',
    '- Keep it concise and factual.',
    '',
    'Field:',
    '- summary: 2-3 sentence summary of what Claude accomplished in this resumed session',
    '',
    'Example valid response:',
    '{"summary":"Claude fixed the authentication bug by updating the token refresh logic. CI passed after the fix."}',
    '',
    'Transcript (last 20 lines):',
    transcript,
  ].join('\n');
}

function selectSchemaAndPrompt(
  agentType: CompletionAgentType,
  transcript: string
): { schema: z.ZodType; prompt: string } {
  if (agentType === 'planning') {
    return { schema: PLANNING_SCHEMA, prompt: buildPlanningPrompt(transcript) };
  }
  if (agentType === 'execution') {
    return { schema: EXECUTION_SCHEMA, prompt: buildExecutionPrompt(transcript) };
  }
  if (agentType === 'review') {
    return { schema: REVIEW_SCHEMA, prompt: buildReviewPrompt(transcript) };
  }
  return { schema: PULL_REQUEST_SCHEMA, prompt: buildPullRequestPrompt(transcript) };
}

function getMissingFields(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    /* v8 ignore start -- upstream: extractAndParseJson guarantees object input; empty path unreachable with z.object schemas @preserve */
    return path !== '' ? path : issue.message;
    /* v8 ignore stop @preserve */
  });
}

function toAgentData(
  agentType: CompletionAgentType,
  parsed: unknown
): PlanningAgentData | ExecutionAgentData | PullRequestAgentData | ReviewAgentData {
  if (agentType === 'planning') {
    const data = parsed as z.infer<typeof PLANNING_SCHEMA>;
    return { agentType: 'planning', ...data };
  }
  if (agentType === 'execution') {
    const data = parsed as z.infer<typeof EXECUTION_SCHEMA>;
    return { agentType: 'execution', ...data };
  }
  if (agentType === 'review') {
    const data = parsed as z.infer<typeof REVIEW_SCHEMA>;
    return { agentType: 'review', ...data };
  }
  const data = parsed as z.infer<typeof PULL_REQUEST_SCHEMA>;
  return { agentType: 'pull_request', ...data };
}

function extractAndParseJson(content: string): unknown {
  const trimmed = content.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return JSON.parse(trimmed) as unknown;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
  }

  throw new Error('LLM verifier response is not valid JSON');
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
    const transcript = getLast50Lines(input.rawLogs);

    const fatalExitCode = detectFatalExitCode(input.rawLogs);
    if (fatalExitCode !== undefined) {
      this.logger.warn(
        {
          taskId: input.taskId,
          attempt: input.attempt,
          agentType: input.agentType,
          exitCode: fatalExitCode,
        },
        'Fatal exit code detected — skipping Gemini verification'
      );
      return {
        passed: false,
        missingFields: [`fatal_exit_code_${String(fatalExitCode)}`],
        verifierFailure: false,
        trace: { transcript, prompt: '', response: '' },
      };
    }

    const { schema, prompt } = selectSchemaAndPrompt(input.agentType, transcript);

    this.logger.info(
      {
        taskId: input.taskId,
        attempt: input.attempt,
        maxAttempts: input.maxAttempts,
        agentType: input.agentType,
        model: this.model,
        promptChars: prompt.length,
        transcript: ((): string => {
          const tLines = transcript.split('\n').filter((l) => l.trim() !== '');
          const first = tLines[0] ?? '';
          const last = tLines[tLines.length - 1] ?? '';
          return tLines.length <= 2
            ? tLines.join('\n')
            : `${first}\n  ... (${String(tLines.length - 2)} lines omitted) ...\n${last}`;
        })(),
      },
      'Gemini completion verifier request'
    );

    const generated = await this.llmClient.generate(prompt);
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
      return {
        passed: false,
        missingFields: [],
        verifierFailure: true,
        trace: { transcript, prompt, response: '' },
      };
    }

    this.logger.info(
      {
        taskId: input.taskId,
        attempt: input.attempt,
        model: this.model,
        responseChars: generated.value.content.length,
        response: generated.value.content,
      },
      'Gemini completion verifier response'
    );

    let rawJson: unknown;
    try {
      rawJson = extractAndParseJson(generated.value.content);
    } catch (error) {
      this.logger.error(
        {
          taskId: input.taskId,
          attempt: input.attempt,
          model: this.model,
          response: generated.value.content,
          error: getErrorMessage(error),
        },
        'Gemini completion verifier response parsing failed'
      );
      return {
        passed: false,
        missingFields: [],
        verifierFailure: true,
        trace: { transcript, prompt, response: generated.value.content },
      };
    }

    const parseResult = schema.safeParse(rawJson);
    if (!parseResult.success) {
      const missingFields = getMissingFields(parseResult.error);
      this.logger.warn(
        {
          taskId: input.taskId,
          attempt: input.attempt,
          model: this.model,
          missingFields,
          zodErrors: parseResult.error.issues,
        },
        'Gemini completion verifier Zod validation failed'
      );
      return {
        passed: false,
        missingFields,
        verifierFailure: false,
        trace: { transcript, prompt, response: generated.value.content },
      };
    }

    const agentData = toAgentData(input.agentType, parseResult.data);

    this.logger.info(
      {
        taskId: input.taskId,
        attempt: input.attempt,
        model: this.model,
        agentData,
      },
      'Gemini completion verifier parsed verdict'
    );

    return {
      passed: true,
      missingFields: [],
      verifierFailure: false,
      agentData,
      trace: { transcript, prompt, response: generated.value.content },
    };
  }

  async extractResumeSummary(taskId: string, rawLogs: string): Promise<string | undefined> {
    const transcript = getLast20Lines(rawLogs);
    const prompt = buildResumeSummaryPrompt(transcript);

    const generated = await this.llmClient.generate(prompt);
    if (!generated.ok) {
      this.logger.error(
        { taskId, errorCode: generated.error.code },
        'extractResumeSummary: LLM generate failed'
      );
      return undefined;
    }

    let rawJson: unknown;
    try {
      rawJson = extractAndParseJson(generated.value.content);
    } catch (error) {
      this.logger.error(
        { taskId, error: getErrorMessage(error) },
        'extractResumeSummary: JSON parse failed'
      );
      return undefined;
    }

    const parseResult = RESUME_SUMMARY_SCHEMA.safeParse(rawJson);
    if (!parseResult.success) {
      this.logger.error({ taskId }, 'extractResumeSummary: Zod validation failed');
      return undefined;
    }

    const { summary } = parseResult.data;
    this.logger.info(
      { taskId, summaryLength: summary.length },
      'extractResumeSummary: summary extracted'
    );
    return summary;
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
