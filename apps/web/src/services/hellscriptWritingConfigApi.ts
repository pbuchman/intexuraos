import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { WritingCategory, WritingStyleConfig, WritingSample } from '@/types';

export async function getWritingConfig(
  accessToken: string
): Promise<WritingStyleConfig> {
  return await apiRequest<WritingStyleConfig>(
    config.hellscriptAgentUrl,
    '/writing-config',
    accessToken
  );
}

export async function updateStyleInstructions(
  accessToken: string,
  category: WritingCategory,
  text: string
): Promise<void> {
  await apiRequest<undefined>(
    config.hellscriptAgentUrl,
    `/writing-config/${encodeURIComponent(category)}/style`,
    accessToken,
    {
      method: 'PUT',
      body: { text },
    }
  );
}

export async function deleteStyleInstructions(
  accessToken: string,
  category: WritingCategory
): Promise<void> {
  await apiRequest<undefined>(
    config.hellscriptAgentUrl,
    `/writing-config/${encodeURIComponent(category)}/style`,
    accessToken,
    {
      method: 'DELETE',
    }
  );
}

export async function listWritingSamples(
  accessToken: string,
  category: WritingCategory
): Promise<WritingSample[]> {
  return await apiRequest<WritingSample[]>(
    config.hellscriptAgentUrl,
    `/writing-config/${encodeURIComponent(category)}/samples`,
    accessToken
  );
}

export async function createWritingSample(
  accessToken: string,
  category: WritingCategory,
  title: string,
  text: string
): Promise<WritingSample> {
  return await apiRequest<WritingSample>(
    config.hellscriptAgentUrl,
    `/writing-config/${encodeURIComponent(category)}/samples`,
    accessToken,
    {
      method: 'POST',
      body: { title, text },
    }
  );
}

export async function updateWritingSample(
  accessToken: string,
  category: WritingCategory,
  sampleId: string,
  title: string,
  text: string
): Promise<void> {
  await apiRequest<undefined>(
    config.hellscriptAgentUrl,
    `/writing-config/${encodeURIComponent(category)}/samples/${encodeURIComponent(sampleId)}`,
    accessToken,
    {
      method: 'PUT',
      body: { title, text },
    }
  );
}

export async function deleteWritingSample(
  accessToken: string,
  category: WritingCategory,
  sampleId: string
): Promise<void> {
  await apiRequest<undefined>(
    config.hellscriptAgentUrl,
    `/writing-config/${encodeURIComponent(category)}/samples/${encodeURIComponent(sampleId)}`,
    accessToken,
    {
      method: 'DELETE',
    }
  );
}
