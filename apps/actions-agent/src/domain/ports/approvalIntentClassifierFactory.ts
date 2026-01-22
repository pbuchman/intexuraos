import type { Result, Logger } from '@intexuraos/common-core';
import type { ApprovalIntentClassifier } from './approvalIntentClassifier.js';

export interface ApprovalIntentClassifierFactoryError {
  code: string;
  message: string;
}

/**
 * Factory for creating approval intent classifiers.
 * Creates classifiers using the user's configured LLM.
 */
export interface ApprovalIntentClassifierFactory {
  /**
   * Create an approval intent classifier for the given user.
   * Uses the user's configured LLM settings.
   */
  createForUser(
    userId: string,
    logger: Logger
  ): Promise<Result<ApprovalIntentClassifier, ApprovalIntentClassifierFactoryError>>;
}
