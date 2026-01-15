import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  createCompositeFeed as createCompositeFeedApi,
  deleteCompositeFeed as deleteCompositeFeedApi,
  getCompositeFeed as getCompositeFeedApi,
  getCompositeFeedData as getCompositeFeedDataApi,
  getCompositeFeedSnapshot as getCompositeFeedSnapshotApi,
  listCompositeFeeds as listCompositeFeedsApi,
  updateCompositeFeed as updateCompositeFeedApi,
} from '@/services/compositeFeedApi';
import type {
  CompositeFeed,
  CompositeFeedData,
  CompositeFeedSnapshot,
  CreateCompositeFeedRequest,
  UpdateCompositeFeedRequest,
} from '@/types';

interface UseCompositeFeedsResult {
  compositeFeeds: CompositeFeed[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (showLoading?: boolean) => Promise<void>;
  createCompositeFeed: (request: CreateCompositeFeedRequest) => Promise<CompositeFeed>;
  deleteCompositeFeed: (id: string) => Promise<void>;
}

export function useCompositeFeeds(): UseCompositeFeedsResult {
  const { getAccessToken } = useAuth();
  const [compositeFeeds, setCompositeFeeds] = useState<CompositeFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (showLoading?: boolean): Promise<void> => {
      const shouldShowLoading = showLoading !== false;

      if (shouldShowLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const data = await listCompositeFeedsApi(token);
        setCompositeFeeds(data);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load composite feeds'));
      } finally {
        if (shouldShowLoading) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [getAccessToken]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createCompositeFeed = useCallback(
    async (request: CreateCompositeFeedRequest): Promise<CompositeFeed> => {
      const token = await getAccessToken();
      const newFeed = await createCompositeFeedApi(token, request);
      setCompositeFeeds((prev) => [newFeed, ...prev]);
      return newFeed;
    },
    [getAccessToken]
  );

  const deleteCompositeFeed = useCallback(
    async (id: string): Promise<void> => {
      const token = await getAccessToken();
      await deleteCompositeFeedApi(token, id);
      setCompositeFeeds((prev) => prev.filter((feed) => feed.id !== id));
    },
    [getAccessToken]
  );

  return {
    compositeFeeds,
    loading,
    refreshing,
    error,
    refresh,
    createCompositeFeed,
    deleteCompositeFeed,
  };
}

interface UseCompositeFeedResult {
  compositeFeed: CompositeFeed | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (showLoading?: boolean) => Promise<void>;
  updateCompositeFeed: (request: UpdateCompositeFeedRequest) => Promise<CompositeFeed>;
  getFeedData: () => Promise<CompositeFeedData>;
  feedData: CompositeFeedData | null;
  feedDataLoading: boolean;
  getSnapshot: (options?: { refresh?: boolean }) => Promise<CompositeFeedSnapshot | null>;
  snapshot: CompositeFeedSnapshot | null;
  snapshotLoading: boolean;
}

export function useCompositeFeed(id: string): UseCompositeFeedResult {
  const { getAccessToken } = useAuth();
  const [compositeFeed, setCompositeFeed] = useState<CompositeFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedData, setFeedData] = useState<CompositeFeedData | null>(null);
  const [feedDataLoading, setFeedDataLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<CompositeFeedSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const refresh = useCallback(
    async (showLoading?: boolean): Promise<void> => {
      if (id === '') {
        setLoading(false);
        return;
      }

      const shouldShowLoading = showLoading !== false;

      if (shouldShowLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const data = await getCompositeFeedApi(token, id);
        setCompositeFeed(data);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load composite feed'));
      } finally {
        if (shouldShowLoading) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [id, getAccessToken]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateCompositeFeed = useCallback(
    async (request: UpdateCompositeFeedRequest): Promise<CompositeFeed> => {
      if (id === '') {
        throw new Error('No composite feed ID');
      }

      const token = await getAccessToken();
      const updated = await updateCompositeFeedApi(token, id, request);
      setCompositeFeed(updated);
      return updated;
    },
    [id, getAccessToken]
  );

  const getFeedData = useCallback(async (): Promise<CompositeFeedData> => {
    if (id === '') {
      throw new Error('No composite feed ID');
    }

    setFeedDataLoading(true);
    try {
      const token = await getAccessToken();
      const data = await getCompositeFeedDataApi(token, id);
      setFeedData(data);
      return data;
    } finally {
      setFeedDataLoading(false);
    }
  }, [id, getAccessToken]);

  const getSnapshot = useCallback(
    async (options?: { refresh?: boolean }): Promise<CompositeFeedSnapshot | null> => {
      if (id === '') {
        throw new Error('No composite feed ID');
      }

      setSnapshotLoading(true);
      try {
        const token = await getAccessToken();
        const data = await getCompositeFeedSnapshotApi(token, id, options);
        setSnapshot(data);
        return data;
      } finally {
        setSnapshotLoading(false);
      }
    },
    [id, getAccessToken]
  );

  return {
    compositeFeed,
    loading,
    refreshing,
    error,
    refresh,
    updateCompositeFeed,
    getFeedData,
    feedData,
    feedDataLoading,
    getSnapshot,
    snapshot,
    snapshotLoading,
  };
}
