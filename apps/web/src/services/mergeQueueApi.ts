import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { MergeQueueBranch, MergeQueuePr, MergeQueueWatch } from '@/types';

export async function listBranches(
  accessToken: string,
  owner: string,
  repo: string
): Promise<{ branches: MergeQueueBranch[] }> {
  const params = new URLSearchParams({ owner, repo });
  return await apiRequest(config.codeAgentUrl, `/code/merge-queue/branches?${params.toString()}`, accessToken);
}

export async function listPrs(
  accessToken: string,
  owner: string,
  repo: string,
  baseBranch: string
): Promise<{ pullRequests: MergeQueuePr[] }> {
  const params = new URLSearchParams({ owner, repo, baseBranch });
  return await apiRequest(config.codeAgentUrl, `/code/merge-queue/prs?${params.toString()}`, accessToken);
}

export async function listWatches(
  accessToken: string,
  owner: string,
  repo: string
): Promise<{ watches: MergeQueueWatch[] }> {
  const params = new URLSearchParams({ owner, repo });
  return await apiRequest(config.codeAgentUrl, `/code/merge-queue/watches?${params.toString()}`, accessToken);
}

export async function createWatch(
  accessToken: string,
  owner: string,
  repo: string,
  baseBranch: string
): Promise<MergeQueueWatch> {
  return await apiRequest(config.codeAgentUrl, '/code/merge-queue/watch', accessToken, {
    method: 'POST',
    body: { owner, repo, baseBranch },
  });
}

export async function cancelWatch(
  accessToken: string,
  watchId: string
): Promise<{ success: boolean }> {
  return await apiRequest(config.codeAgentUrl, `/code/merge-queue/watch/${watchId}`, accessToken, {
    method: 'DELETE',
  });
}
