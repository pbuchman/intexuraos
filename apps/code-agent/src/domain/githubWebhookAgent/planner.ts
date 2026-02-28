import { WebhookAgentDecisionSchema } from './models.js';
import type { WebhookAgentDecision, WebhookEventGroup, WorkerType } from './models.js';

export interface PlannerContext {
  eventGroup: WebhookEventGroup;
  hasExistingTask: boolean;
  existingTaskWorkerType: WorkerType | null;
  confidenceThreshold: number;
}

export interface ValidationError {
  code: string;
  message: string;
  stage: 'json_parse' | 'schema' | 'policy' | 'confidence';
}

export interface PlannerResult {
  decision: WebhookAgentDecision;
  rawText: string;
  validationErrors: readonly ValidationError[];
}

const NOOP_DECISION_BASE = {
  version: '1.0' as const,
  confidence: 0,
  requestedWorkerType: null,
  decision: { kind: 'noop' as const },
};

function makeNoopDecision(
  eventGroup: WebhookEventGroup,
  reasoning: string
): WebhookAgentDecision {
  return {
    ...NOOP_DECISION_BASE,
    eventGroup,
    actionability: 'non_actionable',
    reasoning,
  };
}

const JSON_BLOCK_RE = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/;

function extractJson(raw: string): string {
  const match = JSON_BLOCK_RE.exec(raw);
  if (match?.[1] !== undefined) return match[1].trim();
  return raw.trim();
}

function parseJsonObject(raw: string): { parsed: Record<string, unknown> } | { error: string } {
  const cleaned = extractJson(raw);
  if (cleaned.length === 0) {
    return { error: 'Empty response' };
  }
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'Response is not a JSON object' };
    }
    return { parsed: parsed as Record<string, unknown> };
  } catch {
    return { error: 'Invalid JSON syntax' };
  }
}

export function validateAndNormalizePlannerResponse(
  rawText: string,
  context: PlannerContext
): PlannerResult {
  const jsonResult = parseJsonObject(rawText);
  if ('error' in jsonResult) {
    return {
      decision: makeNoopDecision(context.eventGroup, `JSON parse failed: ${jsonResult.error}`),
      rawText,
      validationErrors: [
        { code: 'json_parse_error', message: jsonResult.error, stage: 'json_parse' },
      ],
    };
  }

  const schemaResult = WebhookAgentDecisionSchema.safeParse(jsonResult.parsed);
  if (!schemaResult.success) {
    const issues = schemaResult.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return {
      decision: makeNoopDecision(context.eventGroup, `Schema validation failed: ${issues}`),
      rawText,
      validationErrors: [
        { code: 'schema_validation_error', message: issues, stage: 'schema' },
      ],
    };
  }

  const decision = schemaResult.data;

  const policyErrors = validatePolicy(decision, context);
  if (policyErrors.length > 0) {
    return {
      decision: makeNoopDecision(
        context.eventGroup,
        `Policy violation: ${policyErrors.map((e) => e.message).join('; ')}`
      ),
      rawText,
      validationErrors: policyErrors,
    };
  }

  if (
    decision.actionability === 'actionable' &&
    decision.confidence < context.confidenceThreshold
  ) {
    return {
      decision: makeNoopDecision(
        context.eventGroup,
        `Confidence ${String(decision.confidence)} below threshold ${String(context.confidenceThreshold)}`
      ),
      rawText,
      validationErrors: [
        {
          code: 'low_confidence',
          message: `Confidence ${String(decision.confidence)} < ${String(context.confidenceThreshold)}`,
          stage: 'confidence',
        },
      ],
    };
  }

  return {
    decision,
    rawText,
    validationErrors: [],
  };
}

function validatePolicy(
  decision: WebhookAgentDecision,
  context: PlannerContext
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (
    context.hasExistingTask &&
    context.existingTaskWorkerType !== null &&
    decision.requestedWorkerType !== null &&
    decision.requestedWorkerType !== context.existingTaskWorkerType
  ) {
    errors.push({
      code: 'policy_violation',
      message: `Worker type switch denied: task uses ${context.existingTaskWorkerType}, requested ${decision.requestedWorkerType}`,
      stage: 'policy',
    });
  }

  return errors;
}
