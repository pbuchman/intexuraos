/**
 * Prompt for classifying user intent from approval reply text.
 *
 * Used by actions-agent to determine whether a user's WhatsApp reply
 * to an approval request indicates approval, rejection, or is unclear.
 */

/**
 * Input for building the approval intent prompt.
 */
export interface ApprovalIntentPromptInput {
  /** The user's reply text to analyze */
  userReply: string;
}

/**
 * Dependencies for building the approval intent prompt.
 */
export interface ApprovalIntentPromptDeps {
  input: ApprovalIntentPromptInput;
}

/**
 * Expected response format from the LLM.
 */
export interface ApprovalIntentResponse {
  intent: 'approve' | 'reject' | 'unclear';
  confidence: number;
  reasoning: string;
}

/**
 * Build the prompt for classifying approval intent from user reply text.
 */
export function approvalIntentPrompt(deps: ApprovalIntentPromptDeps): string {
  const { userReply } = deps.input;

  return `Analyze this user reply to an action approval request.

User replied: "${userReply}"

Determine the user's intent:
- "approve": User wants to proceed (e.g., "yes", "ok", "approve", "go ahead", "👍", "do it", "sure", "yep", "yeah", "fine", "confirmed", "proceed", "let's do it")
- "reject": User wants to cancel (e.g., "no", "reject", "cancel", "don't", "stop", "👎", "nope", "skip", "not now", "later", "remove", "delete")
- "unclear": Cannot determine intent (questions like "what?", unrelated text, ambiguous responses like "maybe", empty text)

Guidelines:
- Be lenient with approval - if the user seems positive or agreeable, classify as approve
- Be lenient with rejection - if the user seems negative or dismissive, classify as reject
- Only use "unclear" when genuinely ambiguous or when the response is a question
- Emojis count: 👍, ✅, ✔️ = approve; 👎, ❌, ✖️ = reject
- Single word affirmations (yes, ok, sure, fine, yep) = approve
- Single word negations (no, nope, nah) = reject
- Empty or whitespace-only text = unclear

Respond with ONLY valid JSON in this exact format:
{
  "intent": "approve" | "reject" | "unclear",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Do not include any text before or after the JSON.`;
}

/**
 * Parse the LLM response into a typed approval intent result.
 * Returns null if parsing fails.
 */
export function parseApprovalIntentResponse(response: string): ApprovalIntentResponse | null {
  try {
    // Try to extract JSON from response (may have surrounding text)
    const jsonMatch = /\{[\s\S]*\}/.exec(response);
    if (jsonMatch === null) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as unknown;

    // The regex only matches {...} patterns, which always parse to objects.
    // The typeof check is defensive but unreachable in practice.
    /* v8 ignore start */
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    /* v8 ignore stop */

    const obj = parsed as Record<string, unknown>;

    // Validate intent
    const intent = obj['intent'];
    if (intent !== 'approve' && intent !== 'reject' && intent !== 'unclear') {
      return null;
    }

    // Validate confidence
    const confidence = obj['confidence'];
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
      return null;
    }

    // Validate reasoning
    const reasoning = obj['reasoning'];
    if (typeof reasoning !== 'string') {
      return null;
    }

    return { intent, confidence, reasoning };
  } catch {
    return null;
  }
}
