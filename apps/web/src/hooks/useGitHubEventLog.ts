import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore';
import { useAuth } from '@/context';
import {
  getGitHubEventLog,
  hydrateGitHubEventLogRows,
} from '@/services/codeAgentApi';
import {
  authenticateFirebase,
  getFirestoreClient,
  initializeFirebase,
  isFirebaseAuthenticated,
} from '@/services/firebase';
import type {
  GitHubDecisionOutcome,
  GitHubDecisionState,
  GitHubEventLogRow,
  GitHubWebhookAction,
  GitHubWebhookEventType,
} from '@/types';

const LIVE_QUERY_LIMIT = 100;
const INITIAL_PAGE_SIZE = 100;

const VISIBLE_EVENT_TYPES: ReadonlySet<string> = new Set<GitHubWebhookEventType>([
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'push',
]);

export interface GitHubEventLogListRow extends GitHubEventLogRow {
  isHydrating: boolean;
}

export interface UseGitHubEventLogResult {
  rows: GitHubEventLogListRow[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  listenerHealthy: boolean;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

interface GitHubEventLogPreviewDoc {
  githubEventName: string;
  eventType: GitHubWebhookEventType;
  action: GitHubWebhookAction | null;
  repository: string | null;
  pullRequestNumber: number | null;
  authPassedAt: unknown;
  updatedAt: unknown;
  decisionState: GitHubDecisionState;
  decisionOutcome: GitHubDecisionOutcome | null;
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const timestamp = value as { toDate: () => Date };
    return timestamp.toDate().toISOString();
  }
  return new Date(String(value)).toISOString();
}

function buildPreviewRow(id: string, data: GitHubEventLogPreviewDoc): GitHubEventLogListRow {
  return {
    id,
    decisionId: null,
    normalizedEventId: null,
    deliveryId: id,
    githubEventName: data.githubEventName,
    eventType: data.eventType,
    action: data.action,
    repository: data.repository,
    repositoryId: null,
    pullRequestNumber: data.pullRequestNumber,
    pullRequestId: null,
    senderLogin: null,
    senderType: null,
    authPassedAt: toIsoString(data.authPassedAt),
    updatedAt: toIsoString(data.updatedAt),
    decisionState: data.decisionState,
    decisionOutcome: data.decisionOutcome,
    decidedBy: null,
    reason: null,
    dispatchAction: null,
    reviewTypes: [],
    taskId: null,
    workerType: null,
    decisionLatencyMs: null,
    isHydrating: true,
  };
}

function sortRows(rows: GitHubEventLogListRow[]): GitHubEventLogListRow[] {
  return [...rows].sort((left, right) => {
    const authDiff = Date.parse(right.authPassedAt) - Date.parse(left.authPassedAt);
    if (authDiff !== 0) {
      return authDiff;
    }
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function rowsEqual(left: GitHubEventLogListRow, right: GitHubEventLogListRow): boolean {
  return (
    left.id === right.id &&
    left.decisionId === right.decisionId &&
    left.normalizedEventId === right.normalizedEventId &&
    left.deliveryId === right.deliveryId &&
    left.githubEventName === right.githubEventName &&
    left.eventType === right.eventType &&
    left.action === right.action &&
    left.repository === right.repository &&
    left.repositoryId === right.repositoryId &&
    left.pullRequestNumber === right.pullRequestNumber &&
    left.pullRequestId === right.pullRequestId &&
    left.senderLogin === right.senderLogin &&
    left.senderType === right.senderType &&
    left.authPassedAt === right.authPassedAt &&
    left.updatedAt === right.updatedAt &&
    left.decisionState === right.decisionState &&
    left.decisionOutcome === right.decisionOutcome &&
    left.decidedBy === right.decidedBy &&
    left.reason === right.reason &&
    left.dispatchAction === right.dispatchAction &&
    left.taskId === right.taskId &&
    left.workerType === right.workerType &&
    left.decisionLatencyMs === right.decisionLatencyMs &&
    left.isHydrating === right.isHydrating &&
    left.reviewTypes.length === right.reviewTypes.length &&
    left.reviewTypes.every((value, index) => value === right.reviewTypes[index])
  );
}

function mergeRows(
  currentRows: GitHubEventLogListRow[],
  incomingRows: GitHubEventLogListRow[],
): GitHubEventLogListRow[] {
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  let didChange = false;

  const mergedRows: GitHubEventLogListRow[] = [];
  const seen = new Set<string>();

  for (const currentRow of currentRows) {
    const incomingRow = incomingRows.find((row) => row.id === currentRow.id);
    if (incomingRow === undefined) {
      mergedRows.push(currentRow);
      seen.add(currentRow.id);
      continue;
    }

    if (rowsEqual(currentRow, incomingRow)) {
      mergedRows.push(currentRow);
    } else {
      mergedRows.push({ ...currentRow, ...incomingRow });
      didChange = true;
    }
    seen.add(currentRow.id);
  }

  for (const incomingRow of incomingRows) {
    if (seen.has(incomingRow.id)) {
      continue;
    }
    mergedRows.push(incomingRow);
    currentById.set(incomingRow.id, incomingRow);
    didChange = true;
  }

  const sortedRows = sortRows(mergedRows);
  const orderChanged = sortedRows.some((row, index) => row !== currentRows[index]);
  return didChange || orderChanged ? sortedRows : currentRows;
}

function clearHydratingState(
  currentRows: GitHubEventLogListRow[],
  ids: string[],
): GitHubEventLogListRow[] {
  const idSet = new Set(ids);
  const nextRows: GitHubEventLogListRow[] = [];
  let didChange = false;

  for (const row of currentRows) {
    if (!idSet.has(row.id) || !row.isHydrating) {
      nextRows.push(row);
      continue;
    }

    nextRows.push({
      ...row,
      isHydrating: false,
    });
    didChange = true;
  }

  return didChange ? nextRows : currentRows;
}

export function useGitHubEventLog(): UseGitHubEventLogResult {
  const { getAccessToken, isAuthenticated, user } = useAuth();
  const [rows, setRows] = useState<GitHubEventLogListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listenerHealthy, setListenerHealthy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const isInitialSnapshotRef = useRef(true);
  const isMountedRef = useRef(true);
  const isSettingUpRef = useRef(false);
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  const hydrateRowsById = useCallback(async (ids: string[]): Promise<void> => {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      return;
    }

    try {
      const token = await getAccessTokenRef.current();
      const data = await hydrateGitHubEventLogRows(token, uniqueIds);
      if (!isMountedRef.current) {
        return;
      }

      const hydratedRows = data.rows.map((row) => ({
        ...row,
        isHydrating: false,
      }));
      setRows((currentRows) => mergeRows(currentRows, hydratedRows));
    } catch (err) {
      if (!isMountedRef.current) {
        return;
      }

      setRows((currentRows) => clearHydratingState(currentRows, uniqueIds));
      setError(getErrorMessage(err, 'Failed to hydrate GitHub event log rows'));
    }
  }, []);

  const fetchRows = useCallback(async (options?: {
    cursor?: string;
    append?: boolean;
    refresh?: boolean;
  }): Promise<void> => {
    if (!isAuthenticated) {
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setNextCursor(null);
      return;
    }

    if (options?.append === true) {
      setLoadingMore(true);
    } else if (options?.refresh === true) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const token = await getAccessTokenRef.current();
      const data = await getGitHubEventLog(token, {
        limit: INITIAL_PAGE_SIZE,
        ...(options?.cursor !== undefined && { cursor: options.cursor }),
      });

      if (!isMountedRef.current) {
        return;
      }

      const incomingRows = data.rows
        .filter((row) => VISIBLE_EVENT_TYPES.has(row.eventType))
        .map((row) => ({
          ...row,
          isHydrating: false,
        }));
      setRows((currentRows) => {
        if (options?.append === true) {
          return mergeRows(currentRows, incomingRows);
        }
        return sortRows(incomingRows);
      });
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err, 'Failed to load GitHub event log'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [isAuthenticated]);

  const refresh = useCallback(async (): Promise<void> => {
    await fetchRows({ refresh: true });
  }, [fetchRows]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (nextCursor === null || loadingMore) {
      return;
    }

    await fetchRows({
      cursor: nextCursor,
      append: true,
    });
  }, [fetchRows, loadingMore, nextCursor]);

  const cleanupListener = useCallback((): void => {
    if (unsubscribeRef.current !== null) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setListenerHealthy(false);
  }, []);

  const setupListener = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || user === undefined || isSettingUpRef.current) {
      return;
    }

    isSettingUpRef.current = true;

    try {
      if (!isFirebaseAuthenticated()) {
        initializeFirebase();
        const token = await getAccessTokenRef.current();
        if (!isMountedRef.current) {
          return;
        }
        await authenticateFirebase(token);
      }

      const db = getFirestoreClient();
      const liveQuery = query(
        collection(db, 'github-event-log-entries'),
        orderBy('authPassedAt', 'desc'),
        limit(LIVE_QUERY_LIMIT),
      );

      isInitialSnapshotRef.current = true;
      unsubscribeRef.current = onSnapshot(
        liveQuery,
        (snapshot) => {
          if (isInitialSnapshotRef.current) {
            isInitialSnapshotRef.current = false;
            return;
          }

          const previewRows: GitHubEventLogListRow[] = [];
          const changedIds: string[] = [];

          for (const change of snapshot.docChanges()) {
            if (change.type !== 'added' && change.type !== 'modified') {
              continue;
            }

            const data = change.doc.data() as GitHubEventLogPreviewDoc;
            if (!VISIBLE_EVENT_TYPES.has(data.eventType)) {
              continue;
            }

            previewRows.push(buildPreviewRow(change.doc.id, data));
            changedIds.push(change.doc.id);
          }

          if (previewRows.length === 0) {
            return;
          }

          setRows((currentRows) => mergeRows(currentRows, previewRows));
          void hydrateRowsById(changedIds);
        },
        (snapshotError) => {
          if (!isMountedRef.current) {
            return;
          }

          setListenerHealthy(false);
          setError(snapshotError.message);
        },
      );
      setListenerHealthy(true);
    } catch (err) {
      if (isMountedRef.current) {
        setListenerHealthy(false);
        setError(getErrorMessage(err, 'Failed to setup GitHub event log listener'));
      }
    } finally {
      isSettingUpRef.current = false;
    }
  }, [cleanupListener, hydrateRowsById, isAuthenticated, user]);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchRows();

    return (): void => {
      isMountedRef.current = false;
    };
  }, [fetchRows]);

  useEffect(() => {
    if (isAuthenticated && user !== undefined) {
      void setupListener();
    } else {
      cleanupListener();
    }

    return (): void => {
      cleanupListener();
    };
  }, [cleanupListener, isAuthenticated, setupListener, user]);

  return {
    rows,
    loading,
    refreshing,
    loadingMore,
    error,
    listenerHealthy,
    hasMore: nextCursor !== null,
    refresh,
    loadMore,
  };
}
