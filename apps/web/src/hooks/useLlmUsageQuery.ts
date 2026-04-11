import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { queryLlmUsage } from '@/services/llmUsageApi';
import type { UsageEventFilters, UsageQueryRow, AggregateMetrics } from '@/types';
import type { ResolvedTimeRange } from '@/utils/llmUsageTimeRange.js';

export interface UseLlmUsageQueryOptions {
  timeRange: ResolvedTimeRange;
  filters: UsageEventFilters;
  groupBy: string[];
  /** When false, the hook skips all API calls and returns empty initial state. Defaults to true. */
  enabled?: boolean;
}

export interface UseLlmUsageQueryResult {
  rows: UsageQueryRow[];
  totals: AggregateMetrics | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const EMPTY_TOTALS: AggregateMetrics = {
  calls: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  thinkingTokens: 0,
  webSearchCalls: 0,
  imageCount: 0,
};

const NOOP_ASYNC = (): Promise<void> => Promise.resolve();

const DISABLED_QUERY_RESULT: UseLlmUsageQueryResult = {
  rows: [],
  totals: null,
  loading: false,
  error: null,
  refresh: NOOP_ASYNC,
};

export function useLlmUsageQuery(options: UseLlmUsageQueryOptions): UseLlmUsageQueryResult {
  const enabled = options.enabled !== false;
  const { getAccessToken } = useAuth();
  const [rows, setRows] = useState<UsageQueryRow[]>([]);
  const [totals, setTotals] = useState<AggregateMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const optionsJsonRef = useRef('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const response = await queryLlmUsage(token, {
        timeRange: options.timeRange,
        filters: options.filters,
        groupBy: options.groupBy,
      });

      if (isMountedRef.current) {
        setRows(response.rows);
        setTotals(response.totals);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err, 'Failed to query usage'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [getAccessToken, options.timeRange, options.filters, options.groupBy]);

  // Stable serialized options for change detection
  const optionsJson = JSON.stringify({
    timeRange: options.timeRange,
    filters: options.filters,
    groupBy: options.groupBy,
  });

  // Initial load + options-change refetch
  useEffect(() => {
    if (!enabled) return;
    // Order matters: set BEFORE the optionsJson early-return so that under
    // React 18 Strict Mode's double-invoke the second pass resets the ref.
    isMountedRef.current = true;
    if (optionsJson === optionsJsonRef.current) return;
    optionsJsonRef.current = optionsJson;
    void refresh();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [enabled, optionsJson, refresh]);

  if (!enabled) {
    return DISABLED_QUERY_RESULT;
  }

  return {
    rows,
    totals,
    loading,
    error,
    refresh,
  };
}

export { EMPTY_TOTALS };
