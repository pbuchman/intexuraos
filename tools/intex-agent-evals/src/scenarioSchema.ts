import { z } from 'zod';
import {
  type AssertionPathValueType,
  IntexAgentSessionEndReasonSchema,
  IntexAgentSessionEventTypeSchema,
  IntexAgentSessionStartReasonSchema,
  IntexAgentSessionStatusSchema,
  IntexAgentToolNameSchema,
  IntexAgentTransitionActionSchema,
  ScenarioAssertionPathSchema,
  ScenarioSourceTypeSchema,
  TIMELINE_PAYLOAD_PATH_METADATA,
  TOOL_ARGUMENT_PATH_METADATA,
} from './types.js';

const SCENARIO_ID_PATTERN = /^intex-eval-[0-9]{3}$/u;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;
const SYNTHETIC_URL_PATTERN = /^https?:\/\/example\.com(?:[/?#]|$)/iu;

const PRIVATE_VALUE_PATTERNS = [
  {
    label: 'e-mail address',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  },
  {
    label: 'Auth0 subject',
    pattern: /\b(?:auth0|google-oauth2|github)\|[A-Za-z0-9_-]{6,}\b/u,
  },
  {
    label: 'Matrix identifier',
    pattern: /(?:^|[^A-Za-z0-9._=-])[@!$][A-Za-z0-9._=-]+:[A-Za-z0-9.-]+(?=$|[^A-Za-z0-9.-])/u,
  },
  {
    label: 'phone number',
    pattern: /(?:^|[^\d])\+[1-9]\d{7,14}(?:$|[^\d])/u,
  },
  {
    label: 'session identifier',
    pattern: /\bintex_session_[A-Za-z0-9_-]{8,}\b/u,
  },
  {
    label: 'message identifier',
    pattern: /\b(?:wamid\.[A-Za-z0-9._:-]{8,}|(?:msg|message)_[A-Za-z0-9_-]{8,})\b/u,
  },
] as const;

function trimmedString(maxLength: number): z.ZodString {
  return z.string().trim().min(1).max(maxLength);
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const AssertionValueSchema = z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
]);
export type AssertionValue = z.infer<typeof AssertionValueSchema>;

export const ValueAssertionSchema = z
  .object({
    path: ScenarioAssertionPathSchema,
    operator: z.enum(['equals', 'contains', 'exists', 'absent']),
    value: AssertionValueSchema.optional(),
  })
  .strict()
  .superRefine((assertion, context) => {
    const requiresValue = assertion.operator === 'equals' || assertion.operator === 'contains';
    if (requiresValue && assertion.value === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `${assertion.operator} assertions require a scalar value`,
      });
    }
    if (!requiresValue && assertion.value !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `${assertion.operator} assertions must not define a value`,
      });
    }
  });
export type ValueAssertion = z.infer<typeof ValueAssertionSchema>;

function validateAssertionValueType(
  assertion: ValueAssertion,
  valueType: AssertionPathValueType,
  context: z.RefinementCtx,
  path: (string | number)[]
): void {
  if (assertion.operator === 'equals') {
    if (assertion.value !== undefined && typeof assertion.value !== valueType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, 'value'],
        message: `equals assertions for ${valueType}-valued paths require a ${valueType} value`,
      });
    }
    return;
  }

  if (assertion.operator !== 'contains') return;

  if (valueType !== 'string') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, 'operator'],
      message: 'contains assertions are only supported for string-valued paths',
    });
  }
  if (typeof assertion.value !== 'string' || assertion.value.trim().length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, 'value'],
      message: 'contains assertions require a non-empty string value',
    });
  }
}

export const ScenarioMessageTurnSchema = z
  .object({
    kind: z.literal('message'),
    text: trimmedString(4000),
    sourceType: ScenarioSourceTypeSchema.optional(),
  })
  .strict();
export type ScenarioMessageTurn = z.infer<typeof ScenarioMessageTurnSchema>;

export const ScenarioConfirmationTurnSchema = z
  .object({
    kind: z.literal('confirmation_button'),
    previousTurnIndex: z.number().int().min(0).max(19),
    decision: z.enum(['accept', 'reject']),
  })
  .strict();
export type ScenarioConfirmationTurn = z.infer<typeof ScenarioConfirmationTurnSchema>;

export const ScenarioTurnSchema = z.discriminatedUnion('kind', [
  ScenarioMessageTurnSchema,
  ScenarioConfirmationTurnSchema,
]);
export type ScenarioTurn = z.infer<typeof ScenarioTurnSchema>;

export const RequiredToolCallExpectationSchema = z
  .object({
    toolName: IntexAgentToolNameSchema,
    count: z.number().int().min(1).max(5),
    argumentAssertions: z.array(ValueAssertionSchema),
  })
  .strict()
  .superRefine((toolCall, context) => {
    const pathMetadata: Readonly<Record<string, AssertionPathValueType>> =
      TOOL_ARGUMENT_PATH_METADATA[toolCall.toolName];
    for (const [index, assertion] of toolCall.argumentAssertions.entries()) {
      const valueType = pathMetadata[assertion.path];
      if (valueType === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['argumentAssertions', index, 'path'],
          message: `Path "${assertion.path}" is not observable for ${toolCall.toolName}`,
        });
        continue;
      }
      validateAssertionValueType(assertion, valueType, context, ['argumentAssertions', index]);
    }
  });
export type RequiredToolCallExpectation = z.infer<typeof RequiredToolCallExpectationSchema>;

export const TransitionExpectationSchema = z
  .object({
    action: IntexAgentTransitionActionSchema,
    previousEndReason: IntexAgentSessionEndReasonSchema.optional(),
  })
  .strict();
export type TransitionExpectation = z.infer<typeof TransitionExpectationSchema>;

export const SessionAfterTurnExpectationSchema = z
  .object({
    allowedStatuses: z.array(IntexAgentSessionStatusSchema).min(1),
    startReason: IntexAgentSessionStartReasonSchema.optional(),
    endReason: IntexAgentSessionEndReasonSchema.optional(),
    activeTool: IntexAgentToolNameSchema.optional(),
  })
  .strict();
export type SessionAfterTurnExpectation = z.infer<typeof SessionAfterTurnExpectationSchema>;

export const TimelinePayloadAssertionSchema = z
  .object({
    eventType: IntexAgentSessionEventTypeSchema,
    assertions: z.array(ValueAssertionSchema),
  })
  .strict()
  .superRefine((payloadAssertion, context) => {
    const pathMetadata: Readonly<Record<string, AssertionPathValueType>> =
      TIMELINE_PAYLOAD_PATH_METADATA;
    for (const [index, assertion] of payloadAssertion.assertions.entries()) {
      const valueType = pathMetadata[assertion.path];
      if (valueType === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assertions', index, 'path'],
          message: `Path "${assertion.path}" is not an observable timeline payload field`,
        });
        continue;
      }
      validateAssertionValueType(assertion, valueType, context, ['assertions', index]);
    }
  });
export type TimelinePayloadAssertion = z.infer<typeof TimelinePayloadAssertionSchema>;

export const TimelineExpectationSchema = z
  .object({
    requiredEventTypes: z.array(IntexAgentSessionEventTypeSchema),
    forbiddenEventTypes: z.array(IntexAgentSessionEventTypeSchema),
    payloadAssertions: z.array(TimelinePayloadAssertionSchema),
  })
  .strict();
export type TimelineExpectation = z.infer<typeof TimelineExpectationSchema>;

export const ReplyExpectationSchema = z
  .object({
    replyIndex: z.number().int().nonnegative(),
    semanticCriteria: z.array(trimmedString(300)).min(1),
  })
  .strict()
  .superRefine((reply, context) => {
    const criteria = new Set<string>();
    for (const [index, criterion] of reply.semanticCriteria.entries()) {
      if (criteria.has(criterion)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['semanticCriteria', index],
          message: `Duplicate semantic criterion "${criterion}"`,
        });
      }
      criteria.add(criterion);
    }
  });
export type ReplyExpectation = z.infer<typeof ReplyExpectationSchema>;

export const TurnExpectationSchema = z
  .object({
    turnIndex: z.number().int().min(0).max(19),
    requiredToolCalls: z.array(RequiredToolCallExpectationSchema),
    forbiddenToolCalls: z.array(IntexAgentToolNameSchema),
    transition: TransitionExpectationSchema,
    sessionAfterTurn: SessionAfterTurnExpectationSchema,
    timeline: TimelineExpectationSchema,
    replies: z.array(ReplyExpectationSchema),
  })
  .strict()
  .superRefine((expectation, context) => {
    const requiredTools = new Set<string>();
    for (const [index, toolCall] of expectation.requiredToolCalls.entries()) {
      if (requiredTools.has(toolCall.toolName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requiredToolCalls', index, 'toolName'],
          message: `Duplicate required tool "${toolCall.toolName}"`,
        });
      }
      requiredTools.add(toolCall.toolName);
    }

    for (const [index, toolName] of expectation.forbiddenToolCalls.entries()) {
      if (requiredTools.has(toolName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['forbiddenToolCalls', index],
          message: `Tool "${toolName}" cannot be both required and forbidden`,
        });
      }
    }

    const requiredEvents = new Set(expectation.timeline.requiredEventTypes);
    for (const [index, eventType] of expectation.timeline.forbiddenEventTypes.entries()) {
      if (requiredEvents.has(eventType)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['timeline', 'forbiddenEventTypes', index],
          message: `Event "${eventType}" cannot be both required and forbidden`,
        });
      }
    }

    for (const [index, reply] of expectation.replies.entries()) {
      if (reply.replyIndex !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['replies', index, 'replyIndex'],
          message: `Reply indexes must be contiguous from zero; expected ${String(index)}`,
        });
      }
    }
  });
export type TurnExpectation = z.infer<typeof TurnExpectationSchema>;

const ExpectedScenarioResultSchema = z
  .object({
    turns: z.array(TurnExpectationSchema),
  })
  .strict();

function visitStrings(
  value: unknown,
  path: (string | number)[],
  visit: (text: string, path: (string | number)[]) => void
): void {
  if (typeof value === 'string') {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) visitStrings(item, [...path, index], visit);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) visitStrings(item, [...path, key], visit);
  }
}

function rejectPrivateTrackedValues(
  scenario: Record<string, unknown>,
  context: z.RefinementCtx
): void {
  visitStrings(scenario, [], (text, path) => {
    for (const privatePattern of PRIVATE_VALUE_PATTERNS) {
      if (privatePattern.pattern.test(text)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `Tracked scenarios must not contain a real-looking ${privatePattern.label}`,
        });
      }
    }

    for (const match of text.matchAll(URL_PATTERN)) {
      const url = match[0];
      if (!SYNTHETIC_URL_PATTERN.test(url)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: 'Tracked scenario URLs must use the documented example.com domain',
        });
      }
    }
  });
}

export const IntexEvalScenarioSchema = z
  .object({
    schemaVersion: z.literal('1'),
    id: z.string().regex(SCENARIO_ID_PATTERN),
    title: trimmedString(160),
    description: trimmedString(1000),
    currentDateTime: z.string().datetime({ offset: true }),
    timeZone: trimmedString(100).refine(isIanaTimeZone, 'Expected an IANA time zone'),
    turns: z.array(ScenarioTurnSchema).min(1).max(20),
    expected: ExpectedScenarioResultSchema,
  })
  .strict()
  .superRefine((scenario, context) => {
    if (scenario.expected.turns.length !== scenario.turns.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expected', 'turns'],
        message: 'Expected turns must contain exactly one entry for every scenario turn',
      });
    }

    for (const [index, expectation] of scenario.expected.turns.entries()) {
      if (expectation.turnIndex !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expected', 'turns', index, 'turnIndex'],
          message: `Turn expectations must be sorted and contiguous; expected ${String(index)}`,
        });
      }
    }

    for (const [index, turn] of scenario.turns.entries()) {
      if (turn.kind !== 'confirmation_button') continue;
      const referencedTurn = scenario.turns[turn.previousTurnIndex];
      if (turn.previousTurnIndex >= index || referencedTurn?.kind !== 'message') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['turns', index, 'previousTurnIndex'],
          message: 'Confirmation turns must reference an earlier message turn',
        });
      }
    }

    rejectPrivateTrackedValues(scenario, context);
  });
export type IntexEvalScenario = z.infer<typeof IntexEvalScenarioSchema>;
