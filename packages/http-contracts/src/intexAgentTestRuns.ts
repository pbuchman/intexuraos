import { ElementType, parseDocument } from 'htmlparser2';
import { z } from 'zod';

import {
  intexAgentToolNameV1Schema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusSafeIdSchema,
} from './matrixCorpus.js';

export const INTEX_AGENT_TEST_RUN_SCENARIO_COUNT = 20 as const;
export const INTEX_AGENT_TEST_RUN_MAX_TOOL_EVIDENCE = 100 as const;
export const INTEX_AGENT_TEST_RUN_MAX_TOOL_FACTS = 16 as const;
export const INTEX_AGENT_TEST_RUN_MAX_DETERMINISTIC_CHECKS = 240 as const;
export const INTEX_AGENT_TEST_RUN_MAX_REPLY_EVALUATIONS = 100 as const;
export const INTEX_AGENT_TEST_RUN_MAX_AGENT_USAGE = 60 as const;
export const INTEX_AGENT_TEST_RUN_MAX_REPLIES_PER_TURN = 5 as const;

const safeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveSafeIntegerSchema = safeIntegerSchema.min(1);
const nullableTimestampSchema = matrixCorpusRfc3339TimestampSchema.nullable();
const evaluationUrlPattern = /\bhttps?:\/\/[^\s<>"')]+|\/#\/[^\s<>"')]+/giu;
const evaluationSensitiveLinePattern =
  /(?:^|[^\p{L}\p{N}])(url|source|zrodlo|źródło|title|tytuł|content|treść|tresc|start|początek|end|koniec|location|miejsce|attendees|uczestnicy|prompt|polecenie|mode|tryb|worker|typ workera|linear|new entry|nowy wpis|entry|wpis|before|wcześniej|przed|after|po zmianie|po)(?![\p{L}\p{N}])[^\p{L}\p{N}]*?(?::|\|)\s*.*$/iu;
const evaluationPreferenceHeaderPattern =
  /^\s*(?:(?:>|[-+*•‣◦▪]|\d+[.)])\s*)*[^\p{L}\p{N}]*(user preferences|prompt preferences|current preferences|rendered prompt block|preferencje|preferencje użytkownika)(?:\s+v\d+)?[^\p{L}\p{N}]*:?\s*$/iu;
const evaluationInlinePreferencePattern =
  /(?:^|[^\p{L}\p{N}])(user preferences|prompt preferences|current preferences|rendered prompt block|preferencje|preferencje użytkownika)(?:\s+v\d+)?(?![\p{L}\p{N}])[^\p{L}\p{N}]*(?::|\|)\s*.*$/iu;
const evaluationSyntheticMarkerPattern =
  /(?<![A-Z0-9-])INTEX-EVAL-[0-9]{3}(?:-F[0-9]{2})?(?![A-Z0-9-])/giu;
const evaluationLineSeparatorPattern = /\r\n|[\n\v\f\r\u0085\u2028\u2029]/u;
const evaluationDatePresentationMarkerPattern =
  /(?:^|[^\p{L}\p{N}])date-presentation(?![\p{L}\p{N}])[^\p{L}\p{N}]*(?::|\|)\s*.*$/iu;
const evaluationDateFieldPattern =
  /(?:^|[^\p{L}\p{N}])(?:start|początek|end|koniec)(?![\p{L}\p{N}])[^\p{L}\p{N}]*?(?::|\|)\s*(.*?)\s*$/iu;
const rawRecordIsoDatePattern =
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?/iu;
const rawRecordIsoDateGlobalPattern =
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?/giu;
const rawRecordDatePattern =
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\.\d{3,9}\b|(?:Z|[+-]\d{2}:\d{2})\s*$|\b(?:UTC|GMT|Europe\/[A-Za-z_]+|America\/[A-Za-z_]+)\b/iu;
const clockTimePattern = /\b\d{1,2}:\d{2}\b/u;
const humanDatePattern = /\b\d{4}\b.*\b\d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}\b.*\b\d{4}\b/u;
const evaluationHtmlCellTags = new Set(['td', 'th', 'dt', 'dd']);
const evaluationHtmlLineTags = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'div',
  'dl',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'ul',
]);
const evaluationHtmlLineBoundary = Symbol('evaluation-html-line-boundary');
const unsafeDecodedEvaluationSeparators = new Set([
  '\u001C',
  '\u001D',
  '\u001E',
  '\u001F',
  '\uE000',
]);

export type IntexAgentReplyDatePresentation =
  | 'not_present'
  | 'human_readable'
  | 'raw_record'
  | 'unreadable';

export function classifyIntexAgentReplyDatePresentation(
  text: string
): IntexAgentReplyDatePresentation {
  const normalizedText = normalizeEvaluationText(text);
  if (rawRecordIsoDatePattern.test(normalizedText)) return 'raw_record';
  const values = normalizedText.split(evaluationLineSeparatorPattern).flatMap((line) => {
    const value = evaluationDateFieldPattern.exec(stripEvaluationMarkup(line))?.[1];
    return value !== undefined && clockTimePattern.test(value) ? [value] : [];
  });
  if (values.length === 0) return 'not_present';
  if (values.some((value) => rawRecordDatePattern.test(value))) return 'raw_record';
  return values.every((value) => humanDatePattern.test(value) && /\p{L}{3,}/u.test(value))
    ? 'human_readable'
    : 'unreadable';
}

export function sanitizeIntexAgentReplyText(text: string): string {
  const datePresentation = classifyIntexAgentReplyDatePresentation(text);
  let inPreferenceBlock = false;
  let inSensitiveDetails = false;
  const lines = normalizeEvaluationText(text)
    .replace(evaluationUrlPattern, '[redacted-url]')
    .replace(rawRecordIsoDateGlobalPattern, '[redacted-date-record]')
    .split(evaluationLineSeparatorPattern);
  const redacted = lines.map((line) => {
    const matchingLine = stripEvaluationMarkup(line);
    if (evaluationDatePresentationMarkerPattern.test(matchingLine)) return '';
    if (
      evaluationPreferenceHeaderPattern.test(matchingLine) ||
      evaluationInlinePreferencePattern.test(matchingLine)
    ) {
      inPreferenceBlock = true;
      return 'User Preferences: [redacted]';
    }
    if (inPreferenceBlock) {
      if (line.trim() === '') {
        inPreferenceBlock = false;
        return line;
      }
      return '[redacted-preference-item]';
    }
    const sensitive = redactEvaluationLine(line);
    if (inSensitiveDetails) return sensitive ?? '';
    if (sensitive === null) return line;
    inSensitiveDetails = true;
    return sensitive;
  });
  const sanitized = redacted
    .join('\n')
    .replace(evaluationSyntheticMarkerPattern, '[synthetic-marker]');
  if (datePresentation === 'not_present') return sanitized;
  const safePresentation = datePresentation.replace('_', '-');
  return `${sanitized}\n[date-presentation: ${safePresentation}]`;
}

function redactEvaluationLine(line: string): string | null {
  const label = evaluationSensitiveLinePattern.exec(stripEvaluationMarkup(line))?.[1];
  return label === undefined ? null : `${label}: [redacted]`;
}

function stripEvaluationMarkup(line: string): string {
  return line.replace(/<[^>\r\n]{1,256}>/gu, ' | ');
}

function normalizeEvaluationText(text: string): string {
  const normalized = text
    .replaceAll('\u001C', '\n')
    .replaceAll('\u001D', '\n')
    .replaceAll('\u001E', '\n')
    .replaceAll('\u001F', '\n')
    .normalize('NFKC')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '');
  return normalizeEvaluationHtml(normalized);
}

type EvaluationHtmlNode =
  | ReturnType<typeof parseDocument>
  | ReturnType<typeof parseDocument>['children'][number];

function normalizeEvaluationHtml(text: string): string {
  let current = text;
  let visible = normalizeDecodedEvaluationText(renderEvaluationHtml([parseDocument(current)]));
  while (visible !== current) {
    current = visible;
    visible = normalizeDecodedEvaluationText(renderEvaluationHtml([parseDocument(current)]));
  }
  return visible;
}

function normalizeDecodedEvaluationText(text: string): string {
  const normalized = text.normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '');
  for (const separator of unsafeDecodedEvaluationSeparators) {
    if (normalized.includes(separator)) return '[redacted-encoded-separator-content]';
  }
  return normalized;
}

type EvaluationHtmlRenderPart = string | typeof evaluationHtmlLineBoundary;

function renderEvaluationHtml(nodes: readonly EvaluationHtmlNode[]): string {
  const parts = renderEvaluationHtmlParts(nodes);
  let rendered = '';
  let pendingBoundary = false;
  for (const part of parts) {
    if (part === evaluationHtmlLineBoundary) {
      pendingBoundary = true;
      continue;
    }
    if (pendingBoundary) {
      if (part.trim() === '') continue;
      rendered += '\n';
      pendingBoundary = false;
    }
    rendered += part;
  }
  return pendingBoundary ? `${rendered}\n` : rendered;
}

function renderEvaluationHtmlParts(
  nodes: readonly EvaluationHtmlNode[]
): EvaluationHtmlRenderPart[] {
  return nodes.flatMap((node): EvaluationHtmlRenderPart[] => {
    if (node.type === ElementType.Text) return [node.data];
    if (!('children' in node)) return [];
    if ('name' in node && (node.name === 'script' || node.name === 'style')) return [];
    const content = renderEvaluationHtmlParts(node.children);
    if (!('name' in node)) return content;
    if (evaluationHtmlCellTags.has(node.name)) return [' | ', ...content, ' | '];
    if (evaluationHtmlLineTags.has(node.name)) {
      return [evaluationHtmlLineBoundary, ...content, evaluationHtmlLineBoundary];
    }
    return content;
  });
}

export const testRunLifecycleSchema = z.enum([
  'preflight',
  'running',
  'finalizing',
  'completed',
  'stopped',
]);
export type TestRunLifecycle = z.infer<typeof testRunLifecycleSchema>;

export const testScenarioLifecycleSchema = z.enum([
  'pending',
  'running',
  'completed',
  'stopped',
  'not_run',
]);
export type TestScenarioLifecycle = z.infer<typeof testScenarioLifecycleSchema>;

export const testVerdictSchema = z.enum(['pending', 'passed', 'failed', 'not_evaluated']);
export type TestVerdict = z.infer<typeof testVerdictSchema>;

export const testArtifactDeliveryV1Schema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.enum(['pending', 'staged', 'ready']),
      failureCode: z.null(),
      updatedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      failureCode: z.enum([
        'REPORT_STAGING_INTERRUPTED',
        'REPORT_STAGING_FAILED',
        'REPORT_VALIDATION_FAILED',
        'REPORT_PUBLICATION_FAILED',
      ]),
      updatedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('unknown'),
      failureCode: z.literal('REPORT_DELIVERY_STATUS_TIMEOUT'),
      updatedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
]);
export type TestArtifactDeliveryV1 = z.infer<typeof testArtifactDeliveryV1Schema>;

export const testRunTotalsV1Schema = z
  .object({
    scenarios: z
      .object({
        planned: safeIntegerSchema.max(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT),
        started: safeIntegerSchema.max(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT),
        running: z.union([z.literal(0), z.literal(1)]),
        completed: safeIntegerSchema.max(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT),
        passed: safeIntegerSchema.max(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT),
        failed: safeIntegerSchema.max(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT),
        notRun: safeIntegerSchema.max(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT),
      })
      .strict(),
    turns: z.object({ planned: safeIntegerSchema, completed: safeIntegerSchema }).strict(),
    replies: z
      .object({
        expected: safeIntegerSchema,
        observed: safeIntegerSchema,
        judged: safeIntegerSchema,
      })
      .strict(),
    tools: z
      .object({
        selected: safeIntegerSchema,
        mockCompleted: safeIntegerSchema,
        mockFailed: safeIntegerSchema,
        unexpectedKnown: safeIntegerSchema,
      })
      .strict(),
    evaluations: z
      .object({
        deterministicPassed: safeIntegerSchema,
        deterministicFailed: safeIntegerSchema,
        minimaxPassed: safeIntegerSchema,
        minimaxFailed: safeIntegerSchema,
        pending: safeIntegerSchema,
      })
      .strict(),
  })
  .strict();
export type TestRunTotalsV1 = z.infer<typeof testRunTotalsV1Schema>;

export const testRunCostV1Schema = z
  .object({
    agentNanoUsd: safeIntegerSchema.nullable(),
    evaluatorNanoUsd: safeIntegerSchema.nullable(),
    totalNanoUsd: safeIntegerSchema.nullable(),
  })
  .strict()
  .superRefine((cost, context) => {
    const bothKnown = cost.agentNanoUsd !== null && cost.evaluatorNanoUsd !== null;
    if (!bothKnown && cost.totalNanoUsd !== null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Total cost requires both components',
      });
    if (
      bothKnown &&
      cost.agentNanoUsd !== null &&
      cost.evaluatorNanoUsd !== null &&
      cost.totalNanoUsd !== cost.agentNanoUsd + cost.evaluatorNanoUsd
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Total cost must equal both components',
      });
  });
export type TestRunCostV1 = z.infer<typeof testRunCostV1Schema>;

const uniqueToolNamesSchema = z
  .array(intexAgentToolNameV1Schema)
  .max(11)
  .superRefine((toolNames, context) => {
    if (new Set(toolNames).size !== toolNames.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Tool names must be unique' });
  });

export const publicTestRunScenarioSummaryV1Schema = z
  .object({
    scenarioId: matrixCorpusSafeIdSchema,
    scenarioNumber: z.number().int().min(1).max(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT),
    scenarioLabel: z.string().min(1).max(256),
    scenarioRevision: safeIntegerSchema,
    lifecycle: testScenarioLifecycleSchema,
    verdict: testVerdictSchema,
    plannedTurns: safeIntegerSchema.max(20),
    completedTurns: safeIntegerSchema.max(20),
    expectedReplies: safeIntegerSchema.max(100),
    completedReplies: safeIntegerSchema.max(100),
    selectedTools: uniqueToolNamesSchema,
    deterministicVerdict: testVerdictSchema,
    semanticVerdict: testVerdictSchema,
    startedAt: nullableTimestampSchema,
    finishedAt: nullableTimestampSchema,
    durationMs: safeIntegerSchema.nullable(),
  })
  .strict();
export type PublicTestRunScenarioSummaryV1 = z.infer<typeof publicTestRunScenarioSummaryV1Schema>;

const intexAgentModelSchema = z.enum([
  'or:deepseek/deepseek-v4-flash',
  'or:minimax/minimax-m3',
  'or:google/gemini-3-flash-preview',
]);

export const publicTestRunHeaderV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    runId: matrixCorpusSafeIdSchema,
    revision: safeIntegerSchema,
    corpusId: matrixCorpusSafeIdSchema,
    corpusVersion: z.string().min(1).max(64),
    transport: z.literal('matrix_whatsapp'),
    executionMode: z.literal('strict_mock_tools'),
    lifecycle: testRunLifecycleSchema,
    verdict: testVerdictSchema,
    artifactDelivery: testArtifactDeliveryV1Schema,
    agentModel: intexAgentModelSchema,
    evaluatorModel: z.literal('or:minimax/minimax-m3'),
    startedAt: matrixCorpusRfc3339TimestampSchema,
    updatedAt: matrixCorpusRfc3339TimestampSchema,
    finishedAt: nullableTimestampSchema,
    currentScenarioNumber: z.number().int().min(1).max(20).nullable(),
    totals: testRunTotalsV1Schema,
    cost: testRunCostV1Schema,
  })
  .strict();
export type PublicTestRunHeaderV1 = z.infer<typeof publicTestRunHeaderV1Schema>;

export const safeToolFactNameV1Schema = z.enum([
  'contentLength',
  'titleLength',
  'summaryLength',
  'promptLength',
  'queryLength',
  'originalMessageLength',
  'locationLength',
  'descriptionLength',
  'messageLength',
  'textLength',
  'tagsCount',
  'sourceMessageIdsCount',
  'attendeesCount',
  'resultCount',
  'maxResults',
  'expectedVersion',
  'currentVersion',
  'hasUrl',
  'hasSourceUrl',
  'hasCalendarId',
  'hasItemId',
  'hasLinearIssueId',
  'startMatchesCatalog',
  'endMatchesCatalog',
  'timeZoneMatchesCatalog',
  'mode',
  'workerType',
  'taskMode',
]);
const safeToolFactValueV1Schema = z.union([
  safeIntegerSchema,
  z.boolean(),
  z.enum(['list', 'count', 'codex', 'codex-xhigh', 'minimax', 'planning', 'execution']),
]);
export const safeToolFactV1Schema = z
  .object({
    name: safeToolFactNameV1Schema,
    value: safeToolFactValueV1Schema,
  })
  .strict();
export type SafeToolFactV1 = z.infer<typeof safeToolFactV1Schema>;

export const safeExpectedToolFactV1Schema = z
  .object({
    name: safeToolFactNameV1Schema,
    operator: z.enum(['exists', 'absent', 'equals']),
    value: safeToolFactValueV1Schema.nullable(),
  })
  .strict()
  .superRefine((fact, context) => {
    if ((fact.operator === 'equals') !== (fact.value !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Equals expectations require one safe value; presence expectations require null',
      });
    }
  });
export type SafeExpectedToolFactV1 = z.infer<typeof safeExpectedToolFactV1Schema>;

export const safeToolEvidenceV1Schema = z
  .object({
    event: z.enum(['selected', 'mock_completed', 'mock_failed', 'unexpected_known_no_execution']),
    toolName: intexAgentToolNameV1Schema,
    turnIndex: safeIntegerSchema.max(19),
    ordinal: positiveSafeIntegerSchema.max(20),
    facts: z.array(safeToolFactV1Schema).max(INTEX_AGENT_TEST_RUN_MAX_TOOL_FACTS),
  })
  .strict();
export type SafeToolEvidenceV1 = z.infer<typeof safeToolEvidenceV1Schema>;

const deterministicTransitionV1Schema = z.enum([
  'created',
  'continued',
  'superseded',
  'completed',
  'failed',
]);
export const safeDeterministicEvidenceV1Schema = z
  .object({
    expectedToolName: intexAgentToolNameV1Schema.nullable(),
    actualToolName: intexAgentToolNameV1Schema.nullable(),
    expectedTurnIndex: safeIntegerSchema.max(19).nullable(),
    actualTurnIndex: safeIntegerSchema.max(19).nullable(),
    expectedCount: safeIntegerSchema.max(20).nullable(),
    actualCount: safeIntegerSchema.max(20).nullable(),
    expectedTransition: deterministicTransitionV1Schema.nullable(),
    actualTransition: deterministicTransitionV1Schema.nullable(),
    expectedFacts: z.array(safeExpectedToolFactV1Schema).max(INTEX_AGENT_TEST_RUN_MAX_TOOL_FACTS),
    actualFacts: z.array(safeToolFactV1Schema).max(INTEX_AGENT_TEST_RUN_MAX_TOOL_FACTS),
  })
  .strict();
export type SafeDeterministicEvidenceV1 = z.infer<typeof safeDeterministicEvidenceV1Schema>;

export const safeDeterministicCheckV1Schema = z
  .object({
    code: z.enum([
      'reply_count',
      'tool_name',
      'tool_count',
      'tool_turn',
      'tool_fact',
      'reply_format',
      'session_transition',
      'lifecycle_event',
      'user_message_count',
      'agent_usage_count',
      'confirmation_count',
      'transport',
    ]),
    status: z.enum(['pending', 'passed', 'failed']),
    turnIndex: safeIntegerSchema.max(19).nullable(),
    replyIndex: positiveSafeIntegerSchema.max(INTEX_AGENT_TEST_RUN_MAX_REPLIES_PER_TURN).nullable(),
    evidence: safeDeterministicEvidenceV1Schema,
  })
  .strict();
export type SafeDeterministicCheckV1 = z.infer<typeof safeDeterministicCheckV1Schema>;

const safeMiniMaxCriterionCodes = [
  'understoodIntent',
  'helpful',
  'conciseAndClear',
  'professionalTone',
  'noPassiveAggression',
] as const;
export const safeMiniMaxCriterionCodeV1Schema = z.enum(safeMiniMaxCriterionCodes);
const minimaxCriteriaSchema = z
  .object({
    understoodIntent: z.boolean(),
    helpful: z.boolean(),
    conciseAndClear: z.boolean(),
    professionalTone: z.boolean(),
    noPassiveAggression: z.boolean(),
  })
  .strict();
const usageTokensSchema = z
  .object({
    logicalCalls: z.literal(1),
    repairCount: z.union([z.literal(0), z.literal(1)]),
    inputTokens: safeIntegerSchema,
    outputTokens: safeIntegerSchema,
    totalTokens: safeIntegerSchema,
    costNanoUsd: safeIntegerSchema,
  })
  .strict()
  .refine((usage) => usage.totalTokens === usage.inputTokens + usage.outputTokens, {
    message: 'Total tokens must equal input plus output',
  });

export const safeReplyEvaluationV1Schema = z
  .object({
    turnIndex: safeIntegerSchema.max(19),
    replyIndex: positiveSafeIntegerSchema.max(INTEX_AGENT_TEST_RUN_MAX_REPLIES_PER_TURN),
    verdict: z.enum(['passed', 'failed']),
    score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    criteria: minimaxCriteriaSchema,
    failureCodes: z.array(safeMiniMaxCriterionCodeV1Schema).max(5),
    latencyMs: safeIntegerSchema,
    usage: usageTokensSchema,
  })
  .strict()
  .superRefine((evaluation, context) => {
    const expectedFailureCodes = safeMiniMaxCriterionCodes.filter(
      (criterion) => !evaluation.criteria[criterion]
    );
    const expectedVerdict = expectedFailureCodes.length === 0 ? 'passed' : 'failed';
    if (
      evaluation.verdict !== expectedVerdict ||
      JSON.stringify(evaluation.failureCodes) !== JSON.stringify(expectedFailureCodes)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MiniMax verdict, criteria, and failure codes must agree',
      });
  });
export type SafeReplyEvaluationV1 = z.infer<typeof safeReplyEvaluationV1Schema>;

export const safeAgentUsageV1Schema = z
  .object({
    turnIndex: safeIntegerSchema.max(19),
    stage: z.enum(['intent_classification', 'agent_generation', 'response_schema_repair']),
    callOrdinal: positiveSafeIntegerSchema.max(3),
    inputTokens: safeIntegerSchema,
    outputTokens: safeIntegerSchema,
    totalTokens: safeIntegerSchema,
    costNanoUsd: safeIntegerSchema,
  })
  .strict()
  .refine((usage) => usage.totalTokens === usage.inputTokens + usage.outputTokens, {
    message: 'Total tokens must equal input plus output',
  });
export type SafeAgentUsageV1 = z.infer<typeof safeAgentUsageV1Schema>;

export const testRunListDtoV1Schema = z
  .object({
    runs: z.array(publicTestRunHeaderV1Schema).max(2),
  })
  .strict();
export type TestRunListDtoV1 = z.infer<typeof testRunListDtoV1Schema>;

export const testRunDtoV1Schema = z
  .object({
    run: publicTestRunHeaderV1Schema,
    scenarios: z
      .array(publicTestRunScenarioSummaryV1Schema)
      .length(INTEX_AGENT_TEST_RUN_SCENARIO_COUNT),
  })
  .strict()
  .superRefine((dto, context) => {
    if (dto.scenarios.some((scenario, index) => scenario.scenarioNumber !== index + 1))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Scenarios must be ordered 1..20' });
    if (new Set(dto.scenarios.map((scenario) => scenario.scenarioId)).size !== dto.scenarios.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Scenario IDs must be unique' });
  });
export type TestRunDtoV1 = z.infer<typeof testRunDtoV1Schema>;

const sourceTimelineBase = {
  timelineIndex: safeIntegerSchema,
  eventSequence: positiveSafeIntegerSchema,
  turnIndex: safeIntegerSchema.max(19),
  createdAt: matrixCorpusRfc3339TimestampSchema,
};

export const publicTestTimelineEventV1Schema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('session_started'),
      ...sourceTimelineBase,
      startReason: z.enum([
        'no_active_session',
        'previous_completed',
        'previous_expired',
        'previous_superseded',
        'user_requested_new_session',
      ]),
      explicit: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('session_closed'),
      ...sourceTimelineBase,
      endReason: z.literal('superseded_by_user'),
      status: z.literal('superseded'),
    })
    .strict(),
  z
    .object({
      type: z.literal('user_message'),
      ...sourceTimelineBase,
      text: z.string().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      type: z.literal('assistant_message'),
      ...sourceTimelineBase,
      replyIndex: positiveSafeIntegerSchema.max(INTEX_AGENT_TEST_RUN_MAX_REPLIES_PER_TURN),
      text: z.string().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      type: z.enum([
        'tool_selected',
        'mock_completed',
        'mock_failed',
        'unexpected_known_no_execution',
      ]),
      ...sourceTimelineBase,
      ordinal: positiveSafeIntegerSchema.max(20),
      toolName: intexAgentToolNameV1Schema,
      facts: z.array(safeToolFactV1Schema).max(INTEX_AGENT_TEST_RUN_MAX_TOOL_FACTS),
    })
    .strict(),
  z
    .object({
      type: z.literal('confirmation_requested'),
      ...sourceTimelineBase,
      toolName: intexAgentToolNameV1Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal('confirmation_resolved'),
      ...sourceTimelineBase,
      toolName: intexAgentToolNameV1Schema,
      resolution: z.enum(['confirmed', 'rejected']),
    })
    .strict(),
  z
    .object({
      type: z.literal('deterministic_evaluation'),
      timelineIndex: safeIntegerSchema,
      verdict: testVerdictSchema,
      checks: z
        .array(safeDeterministicCheckV1Schema)
        .max(INTEX_AGENT_TEST_RUN_MAX_DETERMINISTIC_CHECKS),
    })
    .strict(),
  z
    .object({
      type: z.literal('minimax_evaluation'),
      timelineIndex: safeIntegerSchema,
      evaluatorModel: z.literal('or:minimax/minimax-m3'),
      evaluation: safeReplyEvaluationV1Schema,
    })
    .strict(),
]);
export type PublicTestTimelineEventV1 = z.infer<typeof publicTestTimelineEventV1Schema>;

export const testScenarioDtoV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    runId: matrixCorpusSafeIdSchema,
    runRevision: safeIntegerSchema,
    agentModel: intexAgentModelSchema,
    evaluatorModel: z.literal('or:minimax/minimax-m3'),
    scenario: publicTestRunScenarioSummaryV1Schema,
    eventWatermark: safeIntegerSchema,
    timeline: z.array(publicTestTimelineEventV1Schema).max(512),
  })
  .strict()
  .superRefine((dto, context) => {
    if (dto.timeline.some((event, index) => event.timelineIndex !== index))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Timeline indexes must be contiguous',
      });
  });
export type TestScenarioDtoV1 = z.infer<typeof testScenarioDtoV1Schema>;
