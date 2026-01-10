/**
 * Run synthesis use case.
 * Synthesizes results from completed LLM calls into a final research result.
 * Triggered when all LLMs complete OR when user confirms 'proceed' with partial failure.
 */

import { LlmModels, type GPTImage1, type Gemini25FlashImage } from '@intexuraos/llm-contract';
import {
  buildSourceMap,
  validateSynthesisAttributions,
  parseSections,
  generateBreakdown,
} from '@intexuraos/llm-common';
import type {
  LlmSynthesisProvider,
  NotificationSender,
  ResearchRepository,
  ShareStoragePort,
} from '../ports/index.js';
import type { ContextInferenceProvider } from '../ports/contextInference.js';
import type { ShareInfo, AttributionStatus } from '../models/Research.js';
import type { CoverImageInput } from '../utils/htmlGenerator.js';
import { generateShareableHtml, slugify, generateShareToken } from '../utils/index.js';
import type { ImageServiceClient, GeneratedImageData } from '../../../services.js';
import { repairAttribution } from './repairAttribution.js';

export interface ShareConfig {
  shareBaseUrl: string;
  staticAssetsUrl: string;
}

export interface ImageApiKeys {
  google?: string;
  openai?: string;
}

export interface RunSynthesisDeps {
  researchRepo: ResearchRepository;
  synthesizer: LlmSynthesisProvider;
  notificationSender: NotificationSender;
  shareStorage: ShareStoragePort | null;
  shareConfig: ShareConfig | null;
  imageServiceClient: ImageServiceClient | null;
  contextInferrer?: ContextInferenceProvider;
  userId: string;
  webAppUrl: string;
  reportLlmSuccess?: () => void;
  logger?: { info: (msg: string) => void; error: (obj: object, msg: string) => void };
  imageApiKeys?: ImageApiKeys;
}

export async function runSynthesis(
  researchId: string,
  deps: RunSynthesisDeps
): Promise<{ ok: boolean; error?: string }> {
  const {
    researchRepo,
    synthesizer,
    notificationSender,
    shareStorage,
    shareConfig,
    imageServiceClient,
    contextInferrer,
    userId,
    webAppUrl,
    reportLlmSuccess,
    logger,
    imageApiKeys,
  } = deps;

  logger?.info('[4.1] Loading research from database');
  const researchResult = await researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    logger?.error({}, '[4.1] Research not found');
    return { ok: false, error: 'Research not found' };
  }

  const research = researchResult.value;

  logger?.info('[4.1.1] Updating status to synthesizing');
  await researchRepo.update(researchId, { status: 'synthesizing' });

  const successfulResults = research.llmResults.filter((r) => r.status === 'completed');
  const inputContextsCount = research.inputContexts?.length ?? 0;

  if (successfulResults.length === 0 && inputContextsCount === 0) {
    logger?.error({}, '[4.1.2] No successful LLM results to synthesize');
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: 'No successful LLM results to synthesize',
      completedAt: new Date().toISOString(),
    });
    return { ok: false, error: 'No successful LLM results' };
  }

  const shouldSkipSynthesis = successfulResults.length <= 1 && inputContextsCount === 0;

  if (shouldSkipSynthesis) {
    logger?.info('[4.1.2] Single result, skipping synthesis');
    const now = new Date();
    const startedAt = new Date(research.startedAt);
    const totalDurationMs = now.getTime() - startedAt.getTime();

    await researchRepo.update(researchId, {
      status: 'completed',
      completedAt: now.toISOString(),
      totalDurationMs,
    });

    void notificationSender.sendResearchComplete(
      research.userId,
      researchId,
      research.title,
      `${webAppUrl}/#/research/${researchId}`
    );

    return { ok: true };
  }

  const reports = successfulResults.map((r) => ({
    model: r.model,
    content: r.result ?? '',
  }));

  const additionalSources = research.inputContexts?.map((ctx) => {
    const source: { content: string; label?: string } = { content: ctx.content };
    if (ctx.label !== undefined) {
      source.label = ctx.label;
    }
    return source;
  });

  let synthesisContext = undefined;
  let additionalCostUsd = 0;

  if (contextInferrer !== undefined) {
    logger?.info('[4.2.1] Starting synthesis context inference');
    const contextResult = await contextInferrer.inferSynthesisContext({
      originalPrompt: research.prompt,
      reports: reports.map((r) => ({ model: r.model, content: r.content })),
      additionalSources,
    });
    if (contextResult.ok) {
      synthesisContext = contextResult.value.context;
      additionalCostUsd += contextResult.value.usage.costUsd ?? 0;
      logger?.info(
        `[4.2.2] Synthesis context inferred successfully (costUsd: ${String(contextResult.value.usage.costUsd)})`
      );
    } else {
      if (contextResult.error.usage !== undefined) {
        additionalCostUsd += contextResult.error.usage.costUsd ?? 0;
        logger?.error(
          { error: contextResult.error, costUsd: contextResult.error.usage.costUsd },
          '[4.2.2] Synthesis context inference failed but cost tracked'
        );
      } else {
        logger?.error(
          { error: contextResult.error },
          '[4.2.2] Synthesis context inference failed, proceeding without context'
        );
      }
    }
  }

  logger?.info(`[4.3.1] Starting synthesis LLM call (${String(reports.length)} reports)`);
  const synthesisResult = await synthesizer.synthesize(
    research.prompt,
    reports,
    additionalSources,
    synthesisContext
  );

  if (!synthesisResult.ok) {
    logger?.error({ error: synthesisResult.error.message }, '[4.3.2] Synthesis LLM call failed');
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: synthesisResult.error.message,
      completedAt: new Date().toISOString(),
    });
    return { ok: false, error: synthesisResult.error.message };
  }

  const synthesisContent = synthesisResult.value.content;
  const synthesisUsage = synthesisResult.value.usage;

  logger?.info(`[4.3.2] Synthesis LLM call succeeded (${String(synthesisContent.length)} chars)`);

  // [4.3.3] Post-process synthesis for attribution
  logger?.info('[4.3.3] Starting attribution post-processing');

  const sourceMap = buildSourceMap(reports, additionalSources);
  let processedContent = synthesisContent;
  let attributionStatus: AttributionStatus = 'incomplete';

  const validation = validateSynthesisAttributions(synthesisContent, sourceMap);

  if (validation.valid) {
    attributionStatus = 'complete';
    logger?.info('[4.3.3a] Attribution validation passed');
  } else {
    logger?.info(`[4.3.3b] Attribution validation failed: ${validation.errors.join(', ')}`);

    const repairResult = await repairAttribution(synthesisContent, sourceMap, {
      synthesizer,
      logger,
    });

    if (repairResult.ok) {
      const revalidation = validateSynthesisAttributions(repairResult.value.content, sourceMap);
      if (revalidation.valid) {
        processedContent = repairResult.value.content;
        attributionStatus = 'repaired';
        additionalCostUsd += repairResult.value.usage.costUsd ?? 0;
        logger?.info(
          `[4.3.3c] Attribution repair succeeded (costUsd: ${String(repairResult.value.usage.costUsd)})`
        );
      } else {
        additionalCostUsd += repairResult.value.usage.costUsd ?? 0;
        logger?.info('[4.3.3c] Attribution repair did not fix all issues');
      }
    } else {
      logger?.info('[4.3.3c] Attribution repair failed');
    }
  }

  const sections = parseSections(processedContent);
  const breakdown = generateBreakdown(sections, sourceMap);
  processedContent = `${processedContent}\n\n${breakdown}`;

  logger?.info(`[4.3.4] Attribution status: ${attributionStatus}`);

  // Calculate aggregate totals from all LLM results + synthesis
  const llmTotals = research.llmResults.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + (r.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (r.outputTokens ?? 0),
      costUsd: acc.costUsd + (r.costUsd ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, costUsd: 0 }
  );

  const totalInputTokens = llmTotals.inputTokens + (synthesisUsage?.inputTokens ?? 0);
  const totalOutputTokens = llmTotals.outputTokens + (synthesisUsage?.outputTokens ?? 0);
  const totalCostUsd =
    llmTotals.costUsd +
    (synthesisUsage?.costUsd ?? 0) +
    (research.auxiliaryCostUsd ?? 0) +
    (research.sourceLlmCostUsd ?? 0) +
    additionalCostUsd;

  logger?.info(
    `[4.3.5] Aggregate usage: inputTokens=${String(totalInputTokens)}, outputTokens=${String(totalOutputTokens)}, costUsd=${totalCostUsd.toFixed(6)} (llm=${llmTotals.costUsd.toFixed(6)}, synth=${(synthesisUsage?.costUsd ?? 0).toFixed(6)}, aux=${(research.auxiliaryCostUsd ?? 0).toFixed(6)}, source=${(research.sourceLlmCostUsd ?? 0).toFixed(6)}, add=${additionalCostUsd.toFixed(6)})`
  );

  const now = new Date();
  const startedAt = new Date(research.startedAt);
  const totalDurationMs = now.getTime() - startedAt.getTime();

  let coverImage: CoverImageInput | undefined;
  let coverImageId: string | undefined;

  if (imageServiceClient !== null) {
    logger?.info('[4.4.1] Starting cover image generation');
    const imageResult = await generateCoverImage(
      imageServiceClient,
      processedContent,
      userId,
      imageApiKeys,
      research.synthesisModel,
      logger
    );
    if (imageResult !== null) {
      coverImage = {
        thumbnailUrl: imageResult.thumbnailUrl,
        fullSizeUrl: imageResult.fullSizeUrl,
        alt: research.title,
      };
      coverImageId = imageResult.id;
      logger?.info(`[4.4.4] Cover image generation completed (id: ${imageResult.id})`);
    } else {
      logger?.info('[4.4.4] Cover image generation returned null (see previous errors)');
    }
  } else {
    logger?.info('[4.4] Skipping cover image generation (imageServiceClient is null)');
  }

  let shareInfo: ShareInfo | undefined;
  let shareUrl = `${webAppUrl}/#/research/${researchId}`;

  if (shareStorage !== null && shareConfig !== null) {
    logger?.info('[4.5.1] Generating shareable HTML');
    const shareToken = generateShareToken();
    const slug = slugify(research.title);
    const idPrefix = researchId.slice(0, 6);
    const fileName = `research/${idPrefix}-${shareToken}-${slug}.html`;
    shareUrl = `${shareConfig.shareBaseUrl}/${idPrefix}-${shareToken}-${slug}.html`;

    const html = generateShareableHtml({
      title: research.title,
      synthesizedResult: processedContent,
      shareUrl,
      sharedAt: now.toISOString(),
      staticAssetsUrl: shareConfig.staticAssetsUrl,
      llmResults: research.llmResults,
      ...(research.inputContexts !== undefined && { inputContexts: research.inputContexts }),
      ...(coverImage !== undefined && { coverImage }),
    });

    logger?.info('[4.5.2] Uploading HTML to GCS');
    const uploadResult = await shareStorage.upload(fileName, html);
    if (uploadResult.ok) {
      shareInfo = {
        shareToken,
        slug,
        shareUrl,
        sharedAt: now.toISOString(),
        gcsPath: uploadResult.value.gcsPath,
        ...(coverImageId !== undefined && { coverImageId }),
      };
      logger?.info(`[4.5.3] HTML uploaded successfully (path: ${uploadResult.value.gcsPath})`);
    } else {
      logger?.error({}, '[4.5.3] HTML upload failed');
    }
  }

  logger?.info('[4.6] Saving final research result to database');
  await researchRepo.update(researchId, {
    status: 'completed',
    synthesizedResult: processedContent,
    completedAt: now.toISOString(),
    totalDurationMs,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    attributionStatus,
    ...(shareInfo !== undefined && { shareInfo }),
  });

  if (reportLlmSuccess !== undefined) {
    reportLlmSuccess();
  }

  logger?.info('[4.7] Sending completion notification');
  void notificationSender.sendResearchComplete(
    research.userId,
    researchId,
    research.title,
    shareUrl
  );

  return { ok: true };
}

type ImageModel = GPTImage1 | Gemini25FlashImage;

/**
 * Select image generation model based on available API keys and synthesis model.
 * When synthesis uses OpenAI (gpt-*), prefer GPT for images for consistency.
 * Otherwise, prefer Google (gemini) as default.
 */
function selectImageModel(
  imageApiKeys: ImageApiKeys | undefined,
  synthesisModel?: string
): ImageModel | null {
  const hasGoogleKey = imageApiKeys?.google !== undefined;
  const hasOpenAiKey = imageApiKeys?.openai !== undefined;

  // If synthesis model is OpenAI-based, prefer GPT for images
  const preferOpenAi = synthesisModel?.startsWith('gpt-') === true;

  if (preferOpenAi) {
    if (hasOpenAiKey) return LlmModels.GPTImage1;
    if (hasGoogleKey) return LlmModels.Gemini25FlashImage;
  } else {
    if (hasGoogleKey) return LlmModels.Gemini25FlashImage;
    if (hasOpenAiKey) return LlmModels.GPTImage1;
  }

  return null;
}

async function generateCoverImage(
  client: ImageServiceClient,
  synthesizedResult: string,
  userId: string,
  imageApiKeys: ImageApiKeys | undefined,
  synthesisModel: string | undefined,
  logger?: { info: (msg: string) => void; error: (obj: object, msg: string) => void }
): Promise<GeneratedImageData | null> {
  const promptModel = LlmModels.Gemini25Pro;
  const imageModel = selectImageModel(imageApiKeys, synthesisModel);

  if (imageModel === null) {
    logger?.info(
      '[4.4.1a] No API keys available for image generation (neither Google nor OpenAI key set)'
    );
    return null;
  }

  logger?.info(
    `[4.4.1b] Selected image model: ${imageModel} (Google key: ${imageApiKeys?.google !== undefined ? 'present' : 'missing'}, OpenAI key: ${imageApiKeys?.openai !== undefined ? 'present' : 'missing'})`
  );

  try {
    logger?.info(
      `[4.4.2] Calling image-service /internal/images/prompts/generate (model: ${promptModel})`
    );

    const promptResult = await client.generatePrompt(synthesizedResult, promptModel, userId);
    if (!promptResult.ok) {
      logger?.error(
        {
          errorCode: promptResult.error.code,
          errorMessage: promptResult.error.message,
          model: promptModel,
          userId,
        },
        '[4.4.2] Failed to generate cover image prompt from image-service'
      );
      return null;
    }

    logger?.info(
      `[4.4.3] Prompt generated (title: ${promptResult.value.title}), calling image-service /internal/images/generate (model: ${imageModel})`
    );

    const imageResult = await client.generateImage(promptResult.value.prompt, imageModel, userId, {
      title: promptResult.value.title,
    });
    if (!imageResult.ok) {
      logger?.error(
        {
          errorCode: imageResult.error.code,
          errorMessage: imageResult.error.message,
          model: imageModel,
          userId,
        },
        '[4.4.3] Failed to generate cover image from image-service'
      );
      return null;
    }

    return imageResult.value;
  } catch (error) {
    logger?.error({ error, userId }, '[4.4.ERR] Unexpected error during cover image generation');
    return null;
  }
}
