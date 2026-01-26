/**
 * Completion handlers for LLM call processing.
 * Extracted from the switch statement in process-llm-call endpoint.
 */

import { getProviderForModel } from '@intexuraos/llm-contract';
import type { ResearchRepository, NotificationSender } from '../../domain/research/ports/index.js';
import type { ServiceContainer, DecryptedApiKeys, ImageServiceClient } from '../../services.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { ShareStoragePort } from '../../domain/research/ports/index.js';
import type { ShareConfig } from '../../services.js';
import { runSynthesis } from '../../domain/research/index.js';
import { createSynthesisProviders } from './synthesisHelper.js';
import type { Logger } from '@intexuraos/common-core';

export interface AllCompletedHandlerParams {
  researchId: string;
  userId: string;
  researchRepo: ResearchRepository;
  apiKeys: DecryptedApiKeys;
  services: ServiceContainer;
  userServiceClient: UserServiceClient;
  notificationSender: NotificationSender;
  shareStorage: ShareStoragePort | null;
  shareConfig: ShareConfig | null;
  imageServiceClient: ImageServiceClient | null;
  webAppUrl: string;
  logger: Logger;
}

export async function handleAllCompleted(params: AllCompletedHandlerParams): Promise<void> {
  const {
    researchId,
    userId,
    researchRepo,
    apiKeys,
    services,
    userServiceClient,
    notificationSender,
    shareStorage,
    shareConfig,
    imageServiceClient,
    webAppUrl,
    logger,
  } = params;

  const freshResearch = await researchRepo.findById(researchId);
  if (!freshResearch.ok || freshResearch.value === null) {
    logger.error({ researchId }, '[3.5.2] Research not found for synthesis');
    return;
  }

  if (freshResearch.value.skipSynthesis === true) {
    logger.info(
      { researchId },
      '[3.5.2] All LLMs completed, skipping synthesis (skipSynthesis flag)'
    );
    const now = new Date();
    const startedAt = new Date(freshResearch.value.startedAt);
    await researchRepo.update(researchId, {
      status: 'completed',
      completedAt: now.toISOString(),
      totalDurationMs: now.getTime() - startedAt.getTime(),
    });
    void notificationSender.sendResearchComplete(
      freshResearch.value.userId,
      researchId,
      freshResearch.value.title,
      `${webAppUrl}/#/research/${researchId}`
    );
    return;
  }

  logger.info({ researchId }, '[3.5.2] All LLMs completed, triggering synthesis (Phase 4)');

  const synthesisModel = freshResearch.value.synthesisModel;
  const synthesisProvider = getProviderForModel(synthesisModel);
  const synthesisKey = apiKeys[synthesisProvider];
  if (synthesisKey === undefined) {
    logger.error({ researchId, model: synthesisModel }, '[3.5.2] API key missing for synthesis model');
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: `API key required for synthesis with ${synthesisModel}`,
      completedAt: new Date().toISOString(),
    });
    return;
  }

  const { synthesizer, contextInferrer } = createSynthesisProviders(
    synthesisModel,
    apiKeys,
    userId,
    services,
    logger
  );

  const synthesisResult = await runSynthesis(researchId, {
    researchRepo,
    synthesizer,
    notificationSender,
    shareStorage,
    shareConfig,
    imageServiceClient,
    ...(contextInferrer !== undefined && { contextInferrer }),
    userId,
    webAppUrl,
    reportLlmSuccess: (): void => {
      void userServiceClient.reportLlmSuccess(userId, synthesisProvider);
    },
    logger: {
      info: (obj: object, msg?: string): void => {
        logger.info({ researchId, ...obj }, msg);
      },
      error: (obj: object, msg?: string): void => {
        const message = typeof msg === 'string' ? msg : typeof obj === 'string' ? obj : undefined;
        const context = typeof obj === 'string' ? {} : obj;
        logger.error({ researchId, ...context }, message);
      },
      warn: (obj: object, msg?: string): void => {
        logger.warn({ researchId, ...obj }, msg);
      },
      debug: (obj: object, msg?: string): void => {
        logger.debug({ researchId, ...obj }, msg);
      },
    },
    imageApiKeys: apiKeys,
  });

  if (synthesisResult.ok) {
    logger.info({ researchId }, '[4.END] Synthesis completed successfully');
  } else {
    logger.error({ researchId, error: synthesisResult.error }, '[4.END] Synthesis failed');
  }
}
