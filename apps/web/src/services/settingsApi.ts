import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { AggregatedCosts } from '@/types';

export async function getUsageCosts(
  accessToken: string,
  days?: number
): Promise<AggregatedCosts> {
  const query = days !== undefined ? `?days=${String(days)}` : '';
  return await apiRequest<AggregatedCosts>(
    config.appSettingsServiceUrl,
    `/settings/usage-costs${query}`,
    accessToken
  );
}
