import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  CreateFishingKnowledgeFolderInput,
  CreateFishingKnowledgePageInput,
  FishingChat,
  FishingChatMessage,
  FishingDigestDetail,
  FishingDigestGroup,
  FishingDigestListResponse,
  FishingKnowledgeFolder,
  FishingKnowledgePage,
  ListFishingDigestsOptions,
  SendFishingChatMessageResponse,
  UpdateFishingKnowledgeFolderInput,
  UpdateFishingKnowledgePageInput,
} from '@/types/fishingAssistant';

function buildDigestQuery(options: ListFishingDigestsOptions): string {
  const params = new URLSearchParams();
  params.set('groupKey', options.groupKey);
  params.set('dateFrom', options.dateFrom);
  params.set('dateTo', options.dateTo);
  if (options.terms !== undefined && options.terms.length > 0) {
    params.set('terms', options.terms.join(','));
  }
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  return params.toString();
}

export async function listFishingDigestGroups(accessToken: string): Promise<FishingDigestGroup[]> {
  const response = await apiRequest<{ items: FishingDigestGroup[] }>(
    config.fishingAssistantServiceUrl,
    '/fishing/digest-groups',
    accessToken
  );
  return response.items;
}

export async function listFishingDigests(
  accessToken: string,
  options: ListFishingDigestsOptions
): Promise<FishingDigestListResponse> {
  return await apiRequest<FishingDigestListResponse>(
    config.fishingAssistantServiceUrl,
    `/fishing/digests?${buildDigestQuery(options)}`,
    accessToken
  );
}

export async function getFishingDigestDetail(
  accessToken: string,
  groupKey: string,
  date: string
): Promise<FishingDigestDetail> {
  return await apiRequest<FishingDigestDetail>(
    config.fishingAssistantServiceUrl,
    `/fishing/digests/${encodeURIComponent(groupKey)}/${encodeURIComponent(date)}`,
    accessToken
  );
}

export async function listFishingKnowledgeFolders(
  accessToken: string
): Promise<FishingKnowledgeFolder[]> {
  const response = await apiRequest<{ items: FishingKnowledgeFolder[] }>(
    config.fishingAssistantServiceUrl,
    '/fishing/folders',
    accessToken
  );
  return response.items;
}

export async function createFishingKnowledgeFolder(
  accessToken: string,
  input: CreateFishingKnowledgeFolderInput
): Promise<FishingKnowledgeFolder> {
  const response = await apiRequest<{ folder: FishingKnowledgeFolder }>(
    config.fishingAssistantServiceUrl,
    '/fishing/folders',
    accessToken,
    {
      method: 'POST',
      body: input,
    }
  );
  return response.folder;
}

export async function updateFishingKnowledgeFolder(
  accessToken: string,
  folderId: string,
  input: UpdateFishingKnowledgeFolderInput
): Promise<FishingKnowledgeFolder> {
  const response = await apiRequest<{ folder: FishingKnowledgeFolder }>(
    config.fishingAssistantServiceUrl,
    `/fishing/folders/${encodeURIComponent(folderId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: input,
    }
  );
  return response.folder;
}

export async function deleteFishingKnowledgeFolder(
  accessToken: string,
  folderId: string
): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    config.fishingAssistantServiceUrl,
    `/fishing/folders/${encodeURIComponent(folderId)}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export async function listFishingKnowledgePages(
  accessToken: string,
  folderId?: string
): Promise<FishingKnowledgePage[]> {
  const params = new URLSearchParams();
  if (folderId !== undefined && folderId !== '') {
    params.set('folderId', folderId);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const response = await apiRequest<{ items: FishingKnowledgePage[] }>(
    config.fishingAssistantServiceUrl,
    `/fishing/pages${suffix}`,
    accessToken
  );
  return response.items;
}

export async function createFishingKnowledgePage(
  accessToken: string,
  input: CreateFishingKnowledgePageInput
): Promise<FishingKnowledgePage> {
  const response = await apiRequest<{ page: FishingKnowledgePage }>(
    config.fishingAssistantServiceUrl,
    '/fishing/pages',
    accessToken,
    {
      method: 'POST',
      body: input,
    }
  );
  return response.page;
}

export async function getFishingKnowledgePage(
  accessToken: string,
  pageId: string
): Promise<FishingKnowledgePage> {
  const response = await apiRequest<{ page: FishingKnowledgePage }>(
    config.fishingAssistantServiceUrl,
    `/fishing/pages/${encodeURIComponent(pageId)}`,
    accessToken
  );
  return response.page;
}

export async function updateFishingKnowledgePage(
  accessToken: string,
  pageId: string,
  input: UpdateFishingKnowledgePageInput
): Promise<FishingKnowledgePage> {
  const response = await apiRequest<{ page: FishingKnowledgePage }>(
    config.fishingAssistantServiceUrl,
    `/fishing/pages/${encodeURIComponent(pageId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: input,
    }
  );
  return response.page;
}

export async function deleteFishingKnowledgePage(
  accessToken: string,
  pageId: string
): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    config.fishingAssistantServiceUrl,
    `/fishing/pages/${encodeURIComponent(pageId)}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export async function reindexFishingKnowledgePage(
  accessToken: string,
  pageId: string
): Promise<FishingKnowledgePage> {
  const response = await apiRequest<{ page: FishingKnowledgePage }>(
    config.fishingAssistantServiceUrl,
    `/fishing/pages/${encodeURIComponent(pageId)}/reindex`,
    accessToken,
    { method: 'POST' }
  );
  return response.page;
}

export async function listFishingChats(accessToken: string): Promise<FishingChat[]> {
  const response = await apiRequest<{ items: FishingChat[] }>(
    config.fishingAssistantServiceUrl,
    '/fishing/chats',
    accessToken
  );
  return response.items;
}

export async function createFishingChat(accessToken: string): Promise<FishingChat> {
  const response = await apiRequest<{ chat: FishingChat }>(
    config.fishingAssistantServiceUrl,
    '/fishing/chats',
    accessToken,
    { method: 'POST' }
  );
  return response.chat;
}

export async function listFishingChatMessages(
  accessToken: string,
  chatId: string
): Promise<FishingChatMessage[]> {
  const response = await apiRequest<{ items: FishingChatMessage[] }>(
    config.fishingAssistantServiceUrl,
    `/fishing/chats/${encodeURIComponent(chatId)}/messages`,
    accessToken
  );
  return response.items;
}

export async function sendFishingChatMessage(
  accessToken: string,
  chatId: string,
  message: string
): Promise<SendFishingChatMessageResponse> {
  return await apiRequest<SendFishingChatMessageResponse>(
    config.fishingAssistantServiceUrl,
    `/fishing/chats/${encodeURIComponent(chatId)}/messages`,
    accessToken,
    {
      method: 'POST',
      body: { message },
    }
  );
}
