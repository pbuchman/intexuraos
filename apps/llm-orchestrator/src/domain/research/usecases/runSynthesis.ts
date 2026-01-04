/**
 * Run synthesis use case.
 * Synthesizes results from completed LLM calls into a final research result.
 * Triggered when all LLMs complete OR when user confirms 'proceed' with partial failure.
 */

import type {
  LlmSynthesisProvider,
  NotificationSender,
  ResearchRepository,
  ShareStoragePort,
} from '../ports/index.js';
import type { ShareInfo } from '../models/Research.js';
import type { CoverImageInput } from '../utils/htmlGenerator.js';
import { generateShareableHtml, slugify, generateShareToken } from '../utils/index.js';
import type { ImageServiceClient, GeneratedImageData } from '../../../services.js';

export interface ShareConfig {
  shareBaseUrl: string;
  staticAssetsUrl: string;
}

export interface RunSynthesisDeps {
  researchRepo: ResearchRepository;
  synthesizer: LlmSynthesisProvider;
  notificationSender: NotificationSender;
  shareStorage: ShareStoragePort | null;
  shareConfig: ShareConfig | null;
  imageServiceClient: ImageServiceClient | null;
  userId: string;
  webAppUrl: string;
  reportLlmSuccess?: () => void;
  logger?: { info: (msg: string) => void; error: (obj: object, msg: string) => void };
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
    userId,
    webAppUrl,
    reportLlmSuccess,
    logger,
  } = deps;

  const researchResult = await researchRepo.findById(researchId);
  if (!researchResult.ok || researchResult.value === null) {
    return { ok: false, error: 'Research not found' };
  }

  const research = researchResult.value;

  await researchRepo.update(researchId, { status: 'synthesizing' });

  const successfulResults = research.llmResults.filter((r) => r.status === 'completed');
  const inputContextsCount = research.inputContexts?.length ?? 0;

  if (successfulResults.length === 0 && inputContextsCount === 0) {
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: 'No successful LLM results to synthesize',
      completedAt: new Date().toISOString(),
    });
    return { ok: false, error: 'No successful LLM results' };
  }

  const shouldSkipSynthesis = successfulResults.length <= 1 && inputContextsCount === 0;

  if (shouldSkipSynthesis) {
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

  const synthesisResult = await synthesizer.synthesize(research.prompt, reports, additionalSources);

  if (!synthesisResult.ok) {
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: synthesisResult.error.message,
      completedAt: new Date().toISOString(),
    });
    return { ok: false, error: synthesisResult.error.message };
  }

  const now = new Date();
  const startedAt = new Date(research.startedAt);
  const totalDurationMs = now.getTime() - startedAt.getTime();

  let coverImage: CoverImageInput | undefined;
  let coverImageId: string | undefined;

  if (imageServiceClient !== null) {
    const imageResult = await generateCoverImage(
      imageServiceClient,
      synthesisResult.value,
      userId,
      logger
    );
    if (imageResult !== null) {
      coverImage = {
        thumbnailUrl: imageResult.thumbnailUrl,
        fullSizeUrl: imageResult.fullSizeUrl,
        alt: research.title,
      };
      coverImageId = imageResult.id;
    }
  }

  let shareInfo: ShareInfo | undefined;
  let shareUrl = `${webAppUrl}/#/research/${researchId}`;

  if (shareStorage !== null && shareConfig !== null) {
    const shareToken = generateShareToken();
    const slug = slugify(research.title);
    const idPrefix = researchId.slice(0, 6);
    const fileName = `research/${idPrefix}-${shareToken}-${slug}.html`;
    shareUrl = `${shareConfig.shareBaseUrl}/${idPrefix}-${shareToken}-${slug}.html`;

    const html = generateShareableHtml({
      title: research.title,
      synthesizedResult: synthesisResult.value,
      shareUrl,
      sharedAt: now.toISOString(),
      staticAssetsUrl: shareConfig.staticAssetsUrl,
      llmResults: research.llmResults,
      ...(research.inputContexts !== undefined && { inputContexts: research.inputContexts }),
      ...(coverImage !== undefined && { coverImage }),
    });

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
    }
  }

  await researchRepo.update(researchId, {
    status: 'completed',
    synthesizedResult: synthesisResult.value,
    completedAt: now.toISOString(),
    totalDurationMs,
    ...(shareInfo !== undefined && { shareInfo }),
  });

  if (reportLlmSuccess !== undefined) {
    reportLlmSuccess();
  }

  void notificationSender.sendResearchComplete(
    research.userId,
    researchId,
    research.title,
    shareUrl
  );

  return { ok: true };
}

async function generateCoverImage(
  client: ImageServiceClient,
  synthesizedResult: string,
  userId: string,
  logger?: { info: (msg: string) => void; error: (obj: object, msg: string) => void }
): Promise<GeneratedImageData | null> {
  try {
    logger?.info('Generating cover image prompt');

    const promptResult = await client.generatePrompt(synthesizedResult, 'gemini-2.5-pro', userId);
    if (!promptResult.ok) {
      logger?.error({ error: promptResult.error }, 'Failed to generate cover image prompt');
      return null;
    }

    logger?.info('Generating cover image');

    const imageResult = await client.generateImage(
      promptResult.value.prompt,
      'gpt-image-1',
      userId
    );
    if (!imageResult.ok) {
      logger?.error({ error: imageResult.error }, 'Failed to generate cover image');
      return null;
    }

    logger?.info('Cover image generated successfully');
    return imageResult.value;
  } catch (error) {
    logger?.error({ error }, 'Unexpected error during cover image generation');
    return null;
  }
}
