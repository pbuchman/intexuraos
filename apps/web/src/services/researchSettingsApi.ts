import { config } from '@/config';
import { apiRequest } from './apiClient.js';

/**
 * Research Notion settings from research-agent
 */
export interface ResearchNotionSettings {
  researchPageId: string | null;
}

/**
 * Saved research export settings response
 */
export interface SavedResearchNotionSettings {
  researchPageId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get the current research export Notion page ID setting.
 */
export async function getResearchNotionSettings(
  accessToken: string
): Promise<ResearchNotionSettings> {
  return await apiRequest<ResearchNotionSettings>(
    config.ResearchAgentUrl,
    '/research/settings/notion',
    accessToken
  );
}

/**
 * Save the research export Notion page ID setting.
 */
export async function saveResearchNotionSettings(
  accessToken: string,
  researchPageId: string
): Promise<SavedResearchNotionSettings> {
  return await apiRequest<SavedResearchNotionSettings>(
    config.ResearchAgentUrl,
    '/research/settings/notion',
    accessToken,
    {
      method: 'POST',
      body: { researchPageId },
    }
  );
}
