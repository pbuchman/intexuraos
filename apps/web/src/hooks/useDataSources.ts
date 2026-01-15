import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  createDataSource as createDataSourceApi,
  deleteDataSource as deleteDataSourceApi,
  generateTitle as generateTitleApi,
  getDataSource as getDataSourceApi,
  listDataSources as listDataSourcesApi,
  updateDataSource as updateDataSourceApi,
} from '@/services/dataSourceApi';
import type { CreateDataSourceRequest, DataSource, UpdateDataSourceRequest } from '@/types';

interface UseDataSourcesResult {
  dataSources: DataSource[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (showLoading?: boolean) => Promise<void>;
  createDataSource: (request: CreateDataSourceRequest) => Promise<DataSource>;
  deleteDataSource: (id: string) => Promise<void>;
}

export function useDataSources(): UseDataSourcesResult {
  const { getAccessToken } = useAuth();
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
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
        const data = await listDataSourcesApi(token);
        setDataSources(data);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load data sources'));
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

  const createDataSource = useCallback(
    async (request: CreateDataSourceRequest): Promise<DataSource> => {
      const token = await getAccessToken();
      const newDataSource = await createDataSourceApi(token, request);
      setDataSources((prev) => [newDataSource, ...prev]);
      return newDataSource;
    },
    [getAccessToken]
  );

  const deleteDataSource = useCallback(
    async (id: string): Promise<void> => {
      const token = await getAccessToken();
      await deleteDataSourceApi(token, id);
      setDataSources((prev) => prev.filter((ds) => ds.id !== id));
    },
    [getAccessToken]
  );

  return {
    dataSources,
    loading,
    refreshing,
    error,
    refresh,
    createDataSource,
    deleteDataSource,
  };
}

interface UseDataSourceResult {
  dataSource: DataSource | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (showLoading?: boolean) => Promise<void>;
  updateDataSource: (request: UpdateDataSourceRequest) => Promise<DataSource>;
  generateTitle: (content: string) => Promise<string>;
  generatingTitle: boolean;
}

export function useDataSource(id: string): UseDataSourceResult {
  const { getAccessToken } = useAuth();
  const [dataSource, setDataSource] = useState<DataSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingTitle, setGeneratingTitle] = useState(false);

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
        const data = await getDataSourceApi(token, id);
        setDataSource(data);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load data source'));
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

  const updateDataSource = useCallback(
    async (request: UpdateDataSourceRequest): Promise<DataSource> => {
      if (id === '') {
        throw new Error('No data source ID');
      }

      const token = await getAccessToken();
      const updated = await updateDataSourceApi(token, id, request);
      setDataSource(updated);
      return updated;
    },
    [id, getAccessToken]
  );

  const generateTitle = useCallback(
    async (content: string): Promise<string> => {
      setGeneratingTitle(true);
      try {
        const token = await getAccessToken();
        const result = await generateTitleApi(token, content);
        return result.title;
      } finally {
        setGeneratingTitle(false);
      }
    },
    [getAccessToken]
  );

  return {
    dataSource,
    loading,
    refreshing,
    error,
    refresh,
    updateDataSource,
    generateTitle,
    generatingTitle,
  };
}
