import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { AllProvidersPricing } from '@/types';

export async function getLlmPricing(accessToken: string): Promise<AllProvidersPricing> {
  return await apiRequest<AllProvidersPricing>(
    config.appSettingsServiceUrl,
    '/settings/pricing',
    accessToken
  );
}
