import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '@/components';
import { MonthPicker } from '@/components/notification-digests';
import { FishingDigestList } from '@/components/fishing';
import { useAuth } from '@/context';
import {
  listFishingDigestGroups,
  listFishingDigests,
} from '@/services/fishingAssistantApi';
import { firstDayOfMonth, lastDayOfMonth, currentMonthIso } from '@/utils/digestDates';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import type { FishingDigestGroup, FishingDigestItem } from '@/types/fishingAssistant';

export function FishingDigestsPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [groups, setGroups] = useState<FishingDigestGroup[]>([]);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | undefined>(undefined);
  const [month, setMonth] = useState(() => currentMonthIso());
  const [digests, setDigests] = useState<FishingDigestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const nextGroups = await listFishingDigestGroups(token);
      setGroups(nextGroups);
      if (selectedGroupKey === undefined && nextGroups[0] !== undefined) {
        setSelectedGroupKey(nextGroups[0].groupKey);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load Fishing Assistant digest groups'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, selectedGroupKey]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (
      selectedGroupKey !== undefined &&
      !groups.some((group) => group.groupKey === selectedGroupKey)
    ) {
      setSelectedGroupKey(groups[0]?.groupKey);
    }
  }, [groups, selectedGroupKey]);

  const range = useMemo(
    () => ({
      dateFrom: firstDayOfMonth(month),
      dateTo: lastDayOfMonth(month),
    }),
    [month]
  );

  useEffect(() => {
    if (selectedGroupKey === undefined) {
      setDigests([]);
      return;
    }

    let cancelled = false;
    const loadDigests = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const response = await listFishingDigests(token, {
          groupKey: selectedGroupKey,
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
        });
        if (cancelled) return;
        setDigests([...response.items]);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(getErrorMessage(err, 'Failed to load Fishing Assistant digests'));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDigests();
    return (): void => {
      cancelled = true;
    };
  }, [getAccessToken, range.dateFrom, range.dateTo, selectedGroupKey]);

  return (
    <Layout>
      <div className="mb-6 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Current Digests
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Browse recent fishing-group summaries through the Fishing Assistant service.
          </p>
        </div>
        <div className="w-full sm:w-auto">
          <MonthPicker month={month} onChange={setMonth} />
        </div>
      </div>

      <div className="mb-4 flex min-w-0 flex-wrap gap-2">
        {groups.map((group) => {
          const isActive = group.groupKey === selectedGroupKey;
          return (
            <button
              key={group.groupKey}
              type="button"
              onClick={(): void => { setSelectedGroupKey(group.groupKey); }}
              className={`min-w-0 break-words rounded-full border px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/30 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600'
              }`}
            >
              {group.displayName}
            </button>
          );
        })}
      </div>

      {error !== null ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {loading && digests.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
          No digest subscriptions are available for this account yet.
        </div>
      ) : (
        <FishingDigestList digests={digests} />
      )}
    </Layout>
  );
}
