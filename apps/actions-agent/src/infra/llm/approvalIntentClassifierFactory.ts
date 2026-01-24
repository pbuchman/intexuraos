import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type {
  ApprovalIntentClassifierFactory,
  ApprovalIntentClassifierFactoryError,
} from '../../domain/ports/approvalIntentClassifierFactory.js';
import type { ApprovalIntentClassifier } from '../../domain/ports/approvalIntentClassifier.js';
import type { UserServiceClient } from '../user/userServiceClient.js';
import { createLlmApprovalIntentClassifier } from './llmApprovalIntentClassifier.js';

export interface ApprovalIntentClassifierFactoryConfig {
  userServiceClient: UserServiceClient;
}

/**
 * Creates an approval intent classifier factory.
 * Uses the user's configured LLM to create classifiers.
 */
export function createApprovalIntentClassifierFactory(
  config: ApprovalIntentClassifierFactoryConfig
): ApprovalIntentClassifierFactory {
  const { userServiceClient } = config;

  return {
    async createForUser(
      userId: string,
      logger: Logger
    ): Promise<Result<ApprovalIntentClassifier, ApprovalIntentClassifierFactoryError>> {
      const llmClientResult = await userServiceClient.getLlmClient(userId);

      if (!llmClientResult.ok) {
        return err({
          code: llmClientResult.error.code,
          message: llmClientResult.error.message,
        });
      }

      const classifier = createLlmApprovalIntentClassifier({
        llmClient: llmClientResult.value,
        logger,
      });

      return ok(classifier);
    },
  };
}
