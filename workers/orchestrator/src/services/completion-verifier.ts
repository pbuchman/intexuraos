import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import { LlmModels, type LLMModel, type ModelPricing } from '@intexuraos/llm-contract';
import { StructuredLogUsageSink } from '@intexuraos/llm-pricing';
import { z } from 'zod';
import type { TaskResult } from '../types/task.js';
import { stripDockerHeaders } from './log-formatter.js';
import { OrchestratorFileAuditSink } from './orchestrator-audit-sink.js';

export type CompletionPhase = 'phase1' | 'phase2';

export interface CompletionVerifierInput {
  taskId: string;
  attempt: number;
  maxAttempts: number;
  phase: CompletionPhase;
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

const LLM_VERDICT_SCHEMA = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  missingCriteria: z.array(z.string()),
  resumeInstruction: z.string(),
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

function buildDefaultResumeInstruction(phase: CompletionPhase, missingCriteria: string[]): string {
  /* v8 ignore start -- ts-type: defensive fallback for empty criteria list is unreachable in current verifier flow @preserve */
  const joined =
    missingCriteria.length > 0 ? missingCriteria.join('; ') : 'completion contract not met';
  /* v8 ignore stop @preserve */
  /* v8 ignore start -- source-map: coverage branch mapping reports false-uncovered path on phase selector despite direct unit tests @preserve */
  if (phase === 'phase2') {
    return `Address: ${joined}. Re-run pnpm run ci:tracked, ensure it succeeds, and finish with PHASE2_FINAL.`;
  }
  /* v8 ignore stop @preserve */
  return `Address: ${joined}. Set Linear label (code-task or unclear) and finish with PHASE1_FINAL.`;
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

function verifyPhase1Final(message: string): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];

  if (!message.includes('PHASE1_FINAL:')) {
    missing.push('PHASE1_FINAL block');
  }

  const labelMatch = /- Linear label set:\s*(code-task|unclear)\s*$/im.exec(message);
  const readyMatch = /- Phase 2 ready:\s*(yes|no)\s*$/im.exec(message);
  const linearMatch = /- Linear issue:\s*(https:\/\/linear\.app\/\S+)\s*$/im.exec(message);
  const summaryMatch = /- Summary:\s*(.+)\s*$/im.exec(message);

  if (labelMatch?.[1] === undefined) missing.push('Linear label set line');
  if (readyMatch?.[1] === undefined) missing.push('Phase 2 ready line');
  if (linearMatch?.[1] === undefined) missing.push('Linear issue URL line');
  if ((summaryMatch?.[1] ?? '').trim() === '') missing.push('Summary line');

  const label = labelMatch?.[1]?.toLowerCase();
  const ready = readyMatch?.[1]?.toLowerCase();
  if (label === 'code-task' && ready !== 'yes') {
    missing.push('code-task requires Phase 2 ready: yes');
  }
  if (label === 'unclear' && ready !== 'no') {
    missing.push('unclear requires Phase 2 ready: no');
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true };
}

function verifyPhase2Final(message: string): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];

  if (!message.includes('PHASE2_FINAL:')) {
    missing.push('PHASE2_FINAL block');
  }

  const prMatch = /- PR:\s*(https:\/\/github\.com\/\S+\/pull\/\d+)\s*$/im.exec(message);
  const ciMatch = /- CI evidence:\s*pnpm run ci:tracked successful\s*$/im.exec(message);
  const linearMatch = /- Linear issue:\s*(https:\/\/linear\.app\/\S+)\s*$/im.exec(message);
  const summaryMatch = /- Summary:\s*(.+)\s*$/im.exec(message);

  if (prMatch?.[1] === undefined) missing.push('PR URL line');
  if (ciMatch?.[0] === undefined) missing.push('CI evidence line');
  if (linearMatch?.[1] === undefined) missing.push('Linear issue URL line');
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
        resumeInstruction: buildDefaultResumeInstruction(input.phase, fallbackMissing),
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

    return {
      passed: parsedVerdict.passed,
      confidence: parsedVerdict.confidence,
      reasons: mergedReasons,
      missingCriteria: mergedMissingCriteria,
      resumeInstruction: parsedVerdict.resumeInstruction,
      usedLlm: true,
      verifierFailure: false,
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
      if (input.phase === 'phase1') {
        const phaseResult = verifyPhase1Final(lastAssistantMessage);
        if (!phaseResult.ok) {
          reasons.push('Phase 1 completion contract was not met');
          missingCriteria.push(...phaseResult.missing);
        }
      } else {
        const phaseResult = verifyPhase2Final(lastAssistantMessage);
        if (!phaseResult.ok) {
          reasons.push('Phase 2 completion contract was not met');
          missingCriteria.push(...phaseResult.missing);
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
      input.phase === 'phase1'
        ? [
            'PHASE1_FINAL:',
            '- Linear label set: <code-task|unclear>',
            '- Phase 2 ready: <yes|no>',
            '- Linear issue: <full Linear URL>',
            '- Summary: <one short sentence>',
          ].join('\n')
        : [
            'PHASE2_FINAL:',
            '- PR: <full GitHub PR URL>',
            '- CI evidence: pnpm run ci:tracked successful',
            '- Linear issue: <full Linear URL>',
            '- Summary: <one short sentence>',
          ].join('\n');

    const verifierPrompt = [
      'You are a strict task-completion verifier.',
      'Decide only one thing: PASS or FAIL for this attempt.',
      'Use only provided evidence.',
      'Do not judge code quality.',
      'If evidence is missing, return FAIL.',
      'Return JSON only with the exact schema:',
      '{"passed":boolean,"confidence":number,"reasons":string[],"missingCriteria":string[],"resumeInstruction":string}',
      '',
      `TASK ${input.taskId} ATTEMPT ${String(input.attempt)}/${String(input.maxAttempts)} PHASE ${input.phase}`,
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
        phase: input.phase,
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
  verifyPhase1Final,
  verifyPhase2Final,
  buildDefaultResumeInstruction,
};
