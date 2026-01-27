/**
 * Share queue service for optimistic saving with background sync.
 * Persists pending shares in localStorage and retries until successful.
 */

const QUEUE_KEY = 'intexuraos_share_queue';
const HISTORY_KEY = 'intexuraos_share_history';
const MAX_HISTORY_ITEMS = 50;
const MAX_BACKOFF_RETRIES = 10;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = INITIAL_RETRY_DELAY_MS * Math.pow(2, MAX_BACKOFF_RETRIES);

export type ShareStatus = 'pending' | 'syncing' | 'synced';

export interface ShareQueueItem {
  id: string;
  content: string;
  source: 'pwa-shared';
  externalId: string;
  createdAt: string;
  retryCount: number;
  nextRetryAt: string;
  lastError?: string;
}

export interface ShareHistoryItem {
  id: string;
  contentPreview: string;
  createdAt: string;
  status: ShareStatus;
  syncedAt?: string;
  commandId?: string;
  lastError?: string;
  nextRetryAt?: string;
}

function generateId(): string {
  return `share_${String(Date.now())}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateExternalId(): string {
  return `${String(Date.now())}-${Math.random().toString(36).substring(2, 9)}`;
}

function truncateContent(content: string, maxLength = 100): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength - 3) + '...';
}

export function getQueue(): ShareQueueItem[] {
  try {
    const data = localStorage.getItem(QUEUE_KEY);
    return data !== null ? (JSON.parse(data) as ShareQueueItem[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue: ShareQueueItem[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getHistory(): ShareHistoryItem[] {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    return data !== null ? (JSON.parse(data) as ShareHistoryItem[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(history: ShareHistoryItem[]): void {
  const trimmed = history.slice(0, MAX_HISTORY_ITEMS);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

export function addToQueue(content: string): ShareQueueItem {
  const item: ShareQueueItem = {
    id: generateId(),
    content,
    source: 'pwa-shared',
    externalId: generateExternalId(),
    createdAt: new Date().toISOString(),
    retryCount: 0,
    nextRetryAt: new Date().toISOString(),
  };

  const queue = getQueue();
  queue.push(item);
  saveQueue(queue);

  const history = getHistory();
  history.unshift({
    id: item.id,
    contentPreview: truncateContent(content),
    createdAt: item.createdAt,
    status: 'pending',
  });
  saveHistory(history);

  return item;
}

export function removeFromQueue(id: string): void {
  const queue = getQueue().filter((item) => item.id !== id);
  saveQueue(queue);
}

export function updateQueueItem(id: string, updates: Partial<ShareQueueItem>): void {
  const queue = getQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index !== -1 && queue[index] !== undefined) {
    queue[index] = { ...queue[index], ...updates };
    saveQueue(queue);

    // Also update history with nextRetryAt and lastError
    if (updates.nextRetryAt !== undefined || updates.lastError !== undefined) {
      const history = getHistory();
      const historyIndex = history.findIndex((item) => item.id === id);
      if (historyIndex !== -1 && history[historyIndex] !== undefined) {
        const updatedItem: ShareHistoryItem = {
          ...history[historyIndex],
        };
        if (updates.nextRetryAt !== undefined) {
          updatedItem.nextRetryAt = updates.nextRetryAt;
        }
        if (updates.lastError !== undefined) {
          updatedItem.lastError = updates.lastError;
        }
        history[historyIndex] = updatedItem;
        saveHistory(history);
      }
    }
  }
}

export function markAsSynced(id: string, commandId: string): void {
  removeFromQueue(id);

  const history = getHistory();
  const index = history.findIndex((item) => item.id === id);
  if (index !== -1 && history[index] !== undefined) {
    history[index] = {
      ...history[index],
      status: 'synced',
      syncedAt: new Date().toISOString(),
      commandId,
    };
    saveHistory(history);
  }
}

export function updateHistoryStatus(id: string, status: ShareStatus): void {
  const history = getHistory();
  const index = history.findIndex((item) => item.id === id);
  if (index !== -1 && history[index] !== undefined) {
    history[index] = { ...history[index], status };
    saveHistory(history);
  }
}

export function calculateNextRetryDelay(retryCount: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

export function isRetryDue(item: ShareQueueItem): boolean {
  return new Date(item.nextRetryAt) <= new Date();
}

export function getPendingCount(): number {
  return getQueue().length;
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}
