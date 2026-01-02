import { config } from '@/config';
import { apiRequest } from './apiClient.js';

export type SearchMode = 'deep' | 'quick';

export interface ResearchSettings {
  searchMode: SearchMode;
}

interface UserSettingsResponse {
  userId: string;
  researchSettings?: ResearchSettings;
}

/**
 * Get user's research settings.
 */
export async function getResearchSettings(
  accessToken: string,
  userId: string
): Promise<ResearchSettings> {
  const data = await apiRequest<UserSettingsResponse>(
    config.authServiceUrl,
    `/users/${userId}/settings`,
    accessToken
  );
  return data.researchSettings ?? { searchMode: 'deep' };
}

/**
 * Update user's research settings.
 */
export async function updateResearchSettings(
  accessToken: string,
  userId: string,
  settings: ResearchSettings
): Promise<ResearchSettings> {
  const data = await apiRequest<UserSettingsResponse>(
    config.authServiceUrl,
    `/users/${userId}/settings`,
    accessToken,
    {
      method: 'PATCH',
      body: { researchSettings: settings },
    }
  );
  return data.researchSettings ?? { searchMode: 'deep' };
}
