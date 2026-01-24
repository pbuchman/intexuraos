/**
 * Result of classifying user's approval intent from their reply text.
 */
export type ApprovalIntent = 'approve' | 'reject' | 'unclear';

/**
 * Detailed classification result with confidence and reasoning.
 */
export interface ApprovalIntentResult {
  intent: ApprovalIntent;
  confidence: number;
  reasoning: string;
}

/**
 * Port for classifying user intent from approval reply text.
 * Uses LLM to flexibly detect approval/rejection intent from natural language.
 */
export interface ApprovalIntentClassifier {
  /**
   * Classify the user's reply text to determine their intent.
   *
   * Examples:
   * - "yes", "ok", "approve", "👍" → approve
   * - "no", "cancel", "reject", "👎" → reject
   * - "what is this?", "maybe", "" → unclear
   */
  classify(text: string): Promise<ApprovalIntentResult>;
}
