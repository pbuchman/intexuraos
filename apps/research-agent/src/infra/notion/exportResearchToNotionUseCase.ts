/**
 * Export Research to Notion Use Case
 *
 * Fire-and-forget use case that exports completed research to Notion.
 * Silently skips if user hasn't configured Notion integration or connected their account.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  NotionServiceClient,
  NotionTokenContext,
} from './notionServiceClient.js';
import type { ResearchExportSettingsPort } from '../../domain/research/ports/researchExportSettings.js';
import { exportResearchToNotion as exportToNotion } from './notionResearchExporter.js';
import type { Research, NotionExportInfo } from '../../domain/research/models/Research.js';
import type { RepositoryError } from '../../domain/research/ports/repository.js';

// ============================================================================
// Types
// ============================================================================

export interface ExportResearchToNotionDeps {
  researchRepo: ResearchRepository;
  notionServiceClient: NotionServiceClient;
  researchExportSettings: ResearchExportSettingsPort;
  logger: Logger;
}

export interface ExportResearchToNotionError {
  code: 'NOT_FOUND' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'INTERNAL_ERROR';
  message: string;
}

export interface ResearchRepository {
  findById(id: string): Promise<Result<Research | null, RepositoryError>>;
  update(id: string, data: Partial<Research>): Promise<Result<Research, RepositoryError>>;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Maps NotionServiceClient token response to check if user has connected.
 * Returns true if user has a valid access token.
 */
function hasValidNotionToken(tokenContext: NotionTokenContext): boolean {
  return tokenContext.token !== null && tokenContext.token !== '';
}

// ============================================================================
// Use Case
// ============================================================================

/**
 * Exports a completed research to Notion as a fire-and-forget operation.
 *
 * This use case is designed to be called asynchronously without blocking
 * the main synthesis workflow. It handles all errors gracefully and never
 * throws — errors are logged but not propagated.
 *
 * Flow:
 * 1. Fetch research from repository
 * 2. Check if already exported to Notion (skip to avoid duplicate)
 * 3. Check if research has synthesizedResult (skip if not)
 * 4. Get user's Notion page ID configuration
 * 5. If no page ID configured → silently skip
 * 6. Get user's Notion token
 * 7. If not connected → silently skip
 * 8. Call exportResearchToNotion() from infra layer
 * 9. Save notionExportInfo to research document
 * 10. Log success/failure, return ok regardless
 *
 * @param researchId - The ID of the research to export
 * @param userId - The user ID who owns the research
 * @param deps - Dependencies including repos, clients, and logger
 * @returns Always returns ok() — errors are logged only
 */
export async function exportResearchToNotion(
  researchId: string,
  userId: string,
  deps: ExportResearchToNotionDeps
): Promise<Result<void, ExportResearchToNotionError>> {
  const { researchRepo, notionServiceClient, researchExportSettings, logger } = deps;

  try {
    // 1. Fetch research
    const researchResult = await researchRepo.findById(researchId);
    if (!researchResult.ok) {
      logger.error({ error: researchResult.error.message }, `Failed to fetch research ${researchId} for Notion export`);
      return err({ code: 'INTERNAL_ERROR', message: researchResult.error.message });
    }

    const research = researchResult.value;
    if (research === null) {
      logger.warn({ researchId }, `Research ${researchId} not found for Notion export`);
      return err({ code: 'NOT_FOUND', message: `Research ${researchId} not found` });
    }

    // 2. Check if already exported to Notion (skip to avoid duplicate)
    if (research.notionExportInfo !== undefined) {
      logger.debug({ researchId, mainPageUrl: research.notionExportInfo.mainPageUrl }, `Research ${researchId} already exported to Notion, skipping duplicate export`);
      return ok(undefined);
    }

    // 3. Check if synthesis is complete
    if (research.synthesizedResult === undefined || research.synthesizedResult === '') {
      logger.debug({ researchId }, `Research ${researchId} has no synthesis yet, skipping Notion export`);
      return ok(undefined);
    }

    // 4. Get user's Notion page ID configuration
    const pageIdResult = await researchExportSettings.getResearchPageId(userId);
    if (!pageIdResult.ok) {
      logger.warn({ userId, error: pageIdResult.error.message }, `Failed to get Notion page ID for user ${userId}, skipping export`);
      return ok(undefined);
    }

    const targetPageId = pageIdResult.value;
    if (targetPageId === null || targetPageId === '') {
      logger.debug({ userId }, `User ${userId} has no Notion page ID configured, skipping export`);
      return ok(undefined);
    }

    // 5. Get user's Notion token
    const tokenResult = await notionServiceClient.getNotionToken(userId);
    if (!tokenResult.ok) {
      logger.warn({ userId, error: tokenResult.error.message }, `Failed to get Notion token for user ${userId}, skipping export`);
      return ok(undefined);
    }

    const tokenContext = tokenResult.value;
    if (!hasValidNotionToken(tokenContext)) {
      logger.debug({ userId }, `User ${userId} has not connected Notion, skipping export`);
      return ok(undefined);
    }

    // 6. Export to Notion
    const notionLogger = {
      info: (msg: string): void => {
        logger.info({ msg });
      },
      warn: (msg: string): void => {
        logger.warn({ msg });
      },
      error: (msg: string): void => {
        logger.error({ msg });
      },
      debug: (msg: string): void => {
        logger.debug({ msg });
      },
    };

    // Token is guaranteed to be string here due to hasValidNotionToken check
    const token = tokenContext.token as string;
    const exportResult = await exportToNotion(research, token, targetPageId, notionLogger);

    if (!exportResult.ok) {
      const error = exportResult.error;
      logger.error({ researchId, code: error.code, message: error.message }, `Failed to export research ${researchId} to Notion`);
      return err(error);
    }

    const { mainPageUrl, mainPageId, llmReportPages } = exportResult.value;

    // 7. Save notionExportInfo to research document
    const notionExportInfo: NotionExportInfo = {
      mainPageId,
      mainPageUrl,
      llmReportPageIds: llmReportPages.map((p) => ({
        model: p.model,
        pageId: p.pageId,
      })),
      exportedAt: new Date().toISOString(),
    };

    const saveResult = await researchRepo.update(researchId, { notionExportInfo });
    if (!saveResult.ok) {
      logger.error({ researchId, error: saveResult.error.message }, `Failed to save Notion export info for research ${researchId}`);
      // Continue anyway - export succeeded, just metadata save failed
    }

    logger.info({ researchId, url: mainPageUrl }, `Successfully exported research ${researchId} to Notion`);

    return ok(undefined);
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error({ researchId, error: message }, `Unexpected error exporting research ${researchId} to Notion`);
    return err({ code: 'INTERNAL_ERROR', message });
  }
}
