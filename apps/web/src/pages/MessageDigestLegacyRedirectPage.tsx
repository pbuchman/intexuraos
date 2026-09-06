import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { MessageDigestPageLoading } from '@/components/message-digests/MessageDigestPageLoading';
import { useAuth } from '@/context';
import { ApiError } from '@/services/apiClient.js';
import { resolveLegacyMessageDigestRun } from '@/services/messageDigestsApi';

const LEGACY_ALIAS_MISSING_NOTICE =
  'No matching WhatsApp Message Digest was found for this legacy link.';

export function MessageDigestLegacyRedirectPage(): React.JSX.Element {
  const { groupKey = '', date = '' } = useParams<{ groupKey: string; date: string }>();
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();
  const [retryVersion, setRetryVersion] = useState(0);
  const [hasError, setHasError] = useState(false);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    const controller = new AbortController();
    setHasError(false);

    const resolveAlias = async (): Promise<void> => {
      if (groupKey === '' || date === '') {
        await navigate('/whatsapp/message-digests', {
          replace: true,
          state: { messageDigestNotice: LEGACY_ALIAS_MISSING_NOTICE },
        });
        return;
      }
      try {
        const accessToken = await getAccessToken();
        if (requestSequenceRef.current !== requestId) return;
        const resolved = await resolveLegacyMessageDigestRun(accessToken, groupKey, date, {
          signal: controller.signal,
          refreshToken: getAccessToken,
        });
        if (requestSequenceRef.current !== requestId) return;
        if (resolved.definitionId.trim() === '' || resolved.runId.trim() === '') {
          throw new Error('Invalid legacy alias response');
        }
        await navigate(
          `/whatsapp/message-digests/${encodeURIComponent(resolved.definitionId)}/history/${encodeURIComponent(resolved.runId)}`,
          { replace: true, state: { focusHeading: true } }
        );
      } catch (error) {
        if (requestSequenceRef.current !== requestId || controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          await navigate('/whatsapp/message-digests', {
            replace: true,
            state: { messageDigestNotice: LEGACY_ALIAS_MISSING_NOTICE },
          });
          return;
        }
        setHasError(true);
      }
    };

    void resolveAlias();
    return (): void => {
      requestSequenceRef.current += 1;
      controller.abort();
    };
  }, [date, getAccessToken, groupKey, navigate, retryVersion]);

  if (hasError) {
    return (
      <Layout>
        <section className="mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center rounded-xl border border-red-200 bg-white p-8 text-center dark:border-red-900 dark:bg-slate-900">
          <AlertTriangle aria-hidden="true" className="h-10 w-10 text-red-500" />
          <h1 className="mt-4 text-2xl font-bold text-slate-950 dark:text-slate-50">
            Couldn’t open this legacy Message Digest link
          </h1>
          <p role="alert" className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Couldn’t open this legacy Message Digest link. The resolver is temporarily
            unavailable.
          </p>
          <button
            type="button"
            onClick={(): void => {
              setRetryVersion((version) => version + 1);
            }}
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Try again
          </button>
        </section>
      </Layout>
    );
  }

  return (
    <MessageDigestPageLoading
      title="Message Digests"
      message="Opening the matching WhatsApp Message Digest…"
    />
  );
}
