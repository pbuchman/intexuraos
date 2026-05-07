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

interface TimestampLike {
  toDate: () => Date;
}

interface FirestoreJsonTimestamp {
  _seconds?: number;
  _nanoseconds?: number;
  seconds?: number;
  nanoseconds?: number;
}

type FishingKnowledgeFolderResponse = Omit<FishingKnowledgeFolder, 'createdAt' | 'updatedAt'> & {
  createdAt: unknown;
  updatedAt: unknown;
};

type FishingKnowledgePageResponse = Omit<FishingKnowledgePage, 'createdAt' | 'updatedAt'> & {
  createdAt: unknown;
  updatedAt: unknown;
};

type FishingChatResponse = Omit<FishingChat, 'lastMessageAt' | 'createdAt' | 'updatedAt'> & {
  lastMessageAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

type FishingChatMessageResponse = Omit<FishingChatMessage, 'createdAt'> & {
  createdAt: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isTimestampLike(value: unknown): value is TimestampLike {
  return isRecord(value) && 'toDate' in value && typeof value['toDate'] === 'function';
}

function dateToIsoString(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid Fishing Assistant timestamp value');
  }
  return date.toISOString();
}

function getTimestampNumber(
  timestamp: FirestoreJsonTimestamp,
  underscoreKey: '_seconds' | '_nanoseconds',
  camelKey: 'seconds' | 'nanoseconds'
): number | undefined {
  const underscoreValue = timestamp[underscoreKey];
  if (typeof underscoreValue === 'number' && Number.isFinite(underscoreValue)) {
    return underscoreValue;
  }

  const camelValue = timestamp[camelKey];
  if (typeof camelValue === 'number' && Number.isFinite(camelValue)) {
    return camelValue;
  }

  return undefined;
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string') {
    return dateToIsoString(new Date(value));
  }
  if (value instanceof Date) {
    return dateToIsoString(value);
  }
  if (isTimestampLike(value)) {
    return dateToIsoString(value.toDate());
  }
  if (isRecord(value)) {
    const timestamp = value as FirestoreJsonTimestamp;
    const seconds = getTimestampNumber(timestamp, '_seconds', 'seconds');
    const nanoseconds = getTimestampNumber(timestamp, '_nanoseconds', 'nanoseconds') ?? 0;

    if (seconds !== undefined) {
      return dateToIsoString(new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000)));
    }
  }

  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid Fishing Assistant timestamp value');
  }
  return parsed.toISOString();
}

function normalizeKnowledgeFolder(folder: FishingKnowledgeFolderResponse): FishingKnowledgeFolder {
  return {
    ...folder,
    createdAt: toIsoString(folder.createdAt),
    updatedAt: toIsoString(folder.updatedAt),
  };
}

function normalizeKnowledgePage(page: FishingKnowledgePageResponse): FishingKnowledgePage {
  return {
    ...page,
    createdAt: toIsoString(page.createdAt),
    updatedAt: toIsoString(page.updatedAt),
  };
}

function normalizeChat(chat: FishingChatResponse): FishingChat {
  return {
    ...chat,
    lastMessageAt: toIsoString(chat.lastMessageAt),
    createdAt: toIsoString(chat.createdAt),
    updatedAt: toIsoString(chat.updatedAt),
  };
}

function normalizeChatMessage(message: FishingChatMessageResponse): FishingChatMessage {
  return {
    ...message,
    createdAt: toIsoString(message.createdAt),
  };
}

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
  const response = await apiRequest<{ items: FishingKnowledgeFolderResponse[] }>(
    config.fishingAssistantServiceUrl,
    '/fishing/folders',
    accessToken
  );
  return response.items.map(normalizeKnowledgeFolder);
}

export async function createFishingKnowledgeFolder(
  accessToken: string,
  input: CreateFishingKnowledgeFolderInput
): Promise<FishingKnowledgeFolder> {
  const response = await apiRequest<{ folder: FishingKnowledgeFolderResponse }>(
    config.fishingAssistantServiceUrl,
    '/fishing/folders',
    accessToken,
    {
      method: 'POST',
      body: input,
    }
  );
  return normalizeKnowledgeFolder(response.folder);
}

export async function updateFishingKnowledgeFolder(
  accessToken: string,
  folderId: string,
  input: UpdateFishingKnowledgeFolderInput
): Promise<FishingKnowledgeFolder> {
  const response = await apiRequest<{ folder: FishingKnowledgeFolderResponse }>(
    config.fishingAssistantServiceUrl,
    `/fishing/folders/${encodeURIComponent(folderId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: input,
    }
  );
  return normalizeKnowledgeFolder(response.folder);
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
  const response = await apiRequest<{ items: FishingKnowledgePageResponse[] }>(
    config.fishingAssistantServiceUrl,
    `/fishing/pages${suffix}`,
    accessToken
  );
  return response.items.map(normalizeKnowledgePage);
}

export async function createFishingKnowledgePage(
  accessToken: string,
  input: CreateFishingKnowledgePageInput
): Promise<FishingKnowledgePage> {
  const response = await apiRequest<{ page: FishingKnowledgePageResponse }>(
    config.fishingAssistantServiceUrl,
    '/fishing/pages',
    accessToken,
    {
      method: 'POST',
      body: input,
    }
  );
  return normalizeKnowledgePage(response.page);
}

export async function getFishingKnowledgePage(
  accessToken: string,
  pageId: string
): Promise<FishingKnowledgePage> {
  const response = await apiRequest<{ page: FishingKnowledgePageResponse }>(
    config.fishingAssistantServiceUrl,
    `/fishing/pages/${encodeURIComponent(pageId)}`,
    accessToken
  );
  return normalizeKnowledgePage(response.page);
}

export async function updateFishingKnowledgePage(
  accessToken: string,
  pageId: string,
  input: UpdateFishingKnowledgePageInput
): Promise<FishingKnowledgePage> {
  const response = await apiRequest<{ page: FishingKnowledgePageResponse }>(
    config.fishingAssistantServiceUrl,
    `/fishing/pages/${encodeURIComponent(pageId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: input,
    }
  );
  return normalizeKnowledgePage(response.page);
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
  const response = await apiRequest<{ page: FishingKnowledgePageResponse }>(
    config.fishingAssistantServiceUrl,
    `/fishing/pages/${encodeURIComponent(pageId)}/reindex`,
    accessToken,
    { method: 'POST' }
  );
  return normalizeKnowledgePage(response.page);
}

export async function listFishingChats(accessToken: string): Promise<FishingChat[]> {
  const response = await apiRequest<{ items: FishingChatResponse[] }>(
    config.fishingAssistantServiceUrl,
    '/fishing/chats',
    accessToken
  );
  return response.items.map(normalizeChat);
}

export async function createFishingChat(accessToken: string): Promise<FishingChat> {
  const response = await apiRequest<{ chat: FishingChatResponse }>(
    config.fishingAssistantServiceUrl,
    '/fishing/chats',
    accessToken,
    { method: 'POST' }
  );
  return normalizeChat(response.chat);
}

export async function listFishingChatMessages(
  accessToken: string,
  chatId: string
): Promise<FishingChatMessage[]> {
  const response = await apiRequest<{ items: FishingChatMessageResponse[] }>(
    config.fishingAssistantServiceUrl,
    `/fishing/chats/${encodeURIComponent(chatId)}/messages`,
    accessToken
  );
  return response.items.map(normalizeChatMessage);
}

export async function sendFishingChatMessage(
  accessToken: string,
  chatId: string,
  message: string
): Promise<SendFishingChatMessageResponse> {
  const response = await apiRequest<{
    chat: FishingChatResponse;
    message: FishingChatMessageResponse;
  }>(
    config.fishingAssistantServiceUrl,
    `/fishing/chats/${encodeURIComponent(chatId)}/messages`,
    accessToken,
    {
      method: 'POST',
      body: { message },
    }
  );
  return {
    chat: normalizeChat(response.chat),
    message: normalizeChatMessage(response.message),
  };
}
