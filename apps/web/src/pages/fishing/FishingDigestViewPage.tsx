import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layout, MarkdownContent } from '@/components';
import { DigestState } from '@/components/notification-digests';
import { useAuth } from '@/context';
import { getFishingDigestDetail } from '@/services/fishingAssistantApi';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import type { FishingDigestDetail } from '@/types/fishingAssistant';

export function FishingDigestViewPage(): React.JSX.Element {
  const { groupKey, date } = useParams<{ groupKey: string; date: string }>();
  const { getAccessToken } = useAuth();
  const [detail, setDetail] = useState<FishingDigestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async (): Promise<void> => {
    if (groupKey === undefined || date === undefined) {
      setError('Digest route is missing required parameters.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const response = await getFishingDigestDetail(token, groupKey, date);
      setDetail(response);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load Fishing Assistant digest'));
    } finally {
      setLoading(false);
    }
  }, [date, getAccessToken, groupKey]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  return (
    <Layout>
      <div className="mb-6 min-w-0">
        <Link
          to="/fishing-assistant/digests"
          className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Back to Current Digests
        </Link>
        <h2 className="mt-2 break-words text-2xl font-bold text-slate-900 dark:text-slate-100">
          {detail?.digest.title ?? 'Fishing Digest'}
        </h2>
        {detail !== null ? (
          <p className="break-words text-sm text-slate-500 dark:text-slate-400">
            {detail.digest.date} · {detail.digest.groupKey} · {String(detail.digest.messageCount)} messages
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : error !== null ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : detail === null ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          Digest not found.
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <MarkdownContent content={detail.digest.summaryMarkdown} />
          </div>
          {detail.state !== null ? <DigestState state={detail.state} /> : null}
        </div>
      )}
    </Layout>
  );
}
