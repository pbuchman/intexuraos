/**
 * Port for Research Export Settings operations.
 * Defines the contract for managing research export configuration.
 */

import type { Result } from '@intexuraos/common-core';

export interface ResearchExportSettingsError {
  code: 'INTERNAL_ERROR';
  message: string;
}

export interface ResearchExportSettings {
  researchPageId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchExportSettingsPort {
  getResearchPageId(userId: string): Promise<Result<string | null, ResearchExportSettingsError>>;
  saveResearchPageId(
    userId: string,
    pageId: string
  ): Promise<Result<ResearchExportSettings, ResearchExportSettingsError>>;
}
