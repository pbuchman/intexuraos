import { config } from '@/config';
import { apiRequest } from './apiClient.js';

/**
 * Research Notion settings from research-agent
 */
export interface ResearchNotionSettings {
  researchPageId: string | null;
  researchPageTitle: string | null;
  researchPageUrl: string | null;
}

/**
 * Validated Notion page preview result
 */
export interface ValidatedNotionPage {
  title: string;
  url: string;
}

/**
 * Saved research export settings response
 */
export interface SavedResearchNotionSettings {
  researchPageId: string;
  researchPageTitle: string;
  researchPageUrl: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get the current research export Notion page settings.
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
 * Validate a Notion page ID format and check if the page is accessible.
 * Returns the page title and URL if valid.
 */
export async function validateResearchNotionPage(
  accessToken: string,
  researchPageId: string
): Promise<ValidatedNotionPage> {
  return await apiRequest<ValidatedNotionPage>(
    config.ResearchAgentUrl,
    '/research/settings/notion/validate',
    accessToken,
    {
      method: 'POST',
      body: { researchPageId },
    }
  );
}

/**
 * Save the research export Notion page settings.
 */
export async function saveResearchNotionSettings(
  accessToken: string,
  researchPageId: string,
  researchPageTitle: string,
  researchPageUrl: string
): Promise<SavedResearchNotionSettings> {
  return await apiRequest<SavedResearchNotionSettings>(
    config.ResearchAgentUrl,
    '/research/settings/notion',
    accessToken,
    {
      method: 'POST',
      body: { researchPageId, researchPageTitle, researchPageUrl },
    }
  );
}
