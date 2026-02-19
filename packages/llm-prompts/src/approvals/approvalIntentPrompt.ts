/**
 * Prompt for classifying user intent from approval reply text.
 *
 * Used by actions-agent to determine whether a user's WhatsApp reply
 * to an approval request indicates approval, rejection, or is unclear.
 */

import type { Logger } from 'pino';
import type { PromptBuilder, PromptDeps } from '../types.js';

/**
 * Input for building the approval intent prompt.
 */
export interface ApprovalIntentPromptInput {
  /** The user's reply text to analyze */
  userReply: string;
}

export type ApprovalIntentPromptDeps = PromptDeps;

/**
 * Expected response format from the LLM.
 */
export interface ApprovalIntentResponse {
  intent: 'approve' | 'reject' | 'unclear';
  confidence: number;
  reasoning: string;
}

export const approvalIntentPrompt: PromptBuilder<ApprovalIntentPromptInput> = {
  name: 'approval-intent',
  description: 'Classifies user reply to approval request as approve, reject, or unclear',
  version: '1.0.0',

  build(input: ApprovalIntentPromptInput): string {
    return `Analyze this user reply to an action approval request.

User replied: "${input.userReply}"

Determine the user's intent:
- "approve": User wants to proceed (e.g., "yes", "ok", "approve", "go ahead", "do it", "sure", "yep", "yeah", "fine", "confirmed", "proceed", "let's do it", "tak", "okej", "dawaj", "zatwierdź", "zrób to")
- "reject": User wants to cancel (e.g., "no", "reject", "cancel", "don't", "stop", "nope", "skip", "remove", "delete", "nie", "anuluj", "odrzuć", "usuń", "pomiń")
- "unclear": Cannot determine intent (e.g., "what?", unrelated text, "maybe", "later", "not now", empty text, questions)

Guidelines:
- Default to "unclear" when the response is genuinely ambiguous
- Emojis count: 👍, ✅, ✔️ = approve; 👎, ❌, ✖️ = reject
- Single word affirmations (yes, ok, sure, fine, yep, tak) = approve
- Single word negations (no, nope, nah, nie) = reject
- Deferral words ("later", "not now", "może później") = unclear (NOT reject)
- Empty or whitespace-only text = unclear

Respond with ONLY valid JSON in this exact format:
{
  "intent": "approve" | "reject" | "unclear",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Do not include any text before or after the JSON.`;
  },
};

/**
 * Parse the LLM response into a typed approval intent result.
 *
 * The parser is lenient and extracts the first {...} block from the response,
 * allowing for surrounding text or markdown formatting from the LLM.
 *
 * @param response - Raw LLM response text
 * @returns Parsed approval intent, or null if parsing/validation fails
 */
export function parseApprovalIntentResponse(response: string): ApprovalIntentResponse | null {
  try {
    const jsonMatch = /\{[\s\S]*\}/.exec(response);
    if (jsonMatch === null) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as unknown;

    /* v8 ignore start -- test-infra: block coverage @preserve */
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    /* v8 ignore stop @preserve */

    const obj = parsed as Record<string, unknown>;

    const intent = obj['intent'];
    if (intent !== 'approve' && intent !== 'reject' && intent !== 'unclear') {
      return null;
    }

    const confidence = obj['confidence'];
    if (
      typeof confidence !== 'number' ||
      Number.isNaN(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      return null;
    }

    const reasoning = obj['reasoning'];
    if (typeof reasoning !== 'string') {
      return null;
    }

    return { intent, confidence, reasoning };
  } catch (_error) {
    return null;
  }
}

/**
 * Parse approval intent response with error logging.
 *
 * This version logs parsing failures for debugging and monitoring.
 * Use this in production to track LLM response quality issues.
 *
 * @param response - Raw LLM response string
 * @param logger - Pino logger instance for error logging
 * @returns Parsed approval intent
 * @throws {Error} When parsing fails (error is logged before throwing)
 */
export function parseApprovalIntentResponseWithLogging(
  response: string,
  logger: Logger
): ApprovalIntentResponse {
  const result = parseApprovalIntentResponse(response);
  if (result === null) {
    const errorMessage = 'Failed to parse approval intent: response does not match expected schema';
    logger.warn(
      {
        operation: 'parseApprovalIntentResponse',
        errorMessage,
        llmResponse: response,
        expectedSchema:
          '{"intent":"approve"|"reject"|"unclear","confidence":0.0-1.0,"reasoning":"string"}',
        responseLength: response.length,
      },
      `LLM parse error in parseApprovalIntentResponse: ${errorMessage}`
    );
    throw new Error(errorMessage);
  }
  return result;
}
