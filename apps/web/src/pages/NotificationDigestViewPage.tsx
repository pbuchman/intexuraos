/**
 * Detail page for a single digest at (groupKey, date).
 * Composes atomic components from components/notification-digests/.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Card, Layout } from '@/components';
import {
  DigestActions,
  DigestHeader,
  DigestModeratorPosts,
  DigestNarrative,
  DigestState,
  DigestThreads,
  RegenerateConfirmModal,
} from '@/components/notification-digests';
import { useDigestView } from '@/hooks/useDigestView';

export function NotificationDigestViewPage(): React.JSX.Element {
  const { groupKey, date } = useParams<{ groupKey: string; date: string }>();
  const safeGroupKey = groupKey ?? '';
  const safeDate = date ?? '';
  const {
    digest, state, loading, error,
    regenerating, regenerateError, lastRegenerateResult,
    regenerate,
  } = useDigestView(safeGroupKey, safeDate);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirmRegenerate = (): void => {
    void regenerate().then(() => { setConfirmOpen(false); });
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </Layout>
    );
  }

  if (error !== null) {
    return (
      <Layout>
        <Card variant="error" className="mt-4">
          <p>{error}</p>
        </Card>
      </Layout>
    );
  }

  if (digest === null) {
    return (
      <Layout>
        <Card className="mt-4">
          <p className="text-slate-600 dark:text-slate-300">
            Brak podsumowania dla dnia {safeDate}. Kliknij poniżej, aby je wygenerować.
          </p>
          <button
            type="button"
            onClick={(): void => { setConfirmOpen(true); }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={regenerating}
          >
            {regenerating ? 'Generowanie…' : 'Wygeneruj podsumowanie'}
          </button>
          <RegenerateConfirmModal
            isOpen={confirmOpen}
            currentGeneration={0}
            date={safeDate}
            onCancel={(): void => { setConfirmOpen(false); }}
            onConfirm={handleConfirmRegenerate}
            busy={regenerating}
          />
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <DigestHeader
        digest={digest}
        groupKey={safeGroupKey}
        regenerating={regenerating}
        onRequestRegenerate={(): void => { setConfirmOpen(true); }}
      />

      {lastRegenerateResult?.lockSkipped === true ? (
        <Card variant="warning" className="mb-6">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Inne zadanie wygenerowania tego dnia jest już w toku. Spróbuj ponownie za chwilę.
          </p>
        </Card>
      ) : null}

      {regenerateError !== null ? (
        <Card variant="error" className="mb-6">
          <p className="text-sm">{regenerateError}</p>
        </Card>
      ) : null}

      <DigestNarrative narrative={digest.summary.narrative} />
      <DigestThreads threads={digest.summary.threads} />
      <DigestModeratorPosts posts={digest.summary.moderatorPosts} />

      {state !== null ? <DigestState state={state} /> : null}

      <DigestActions
        summary={digest.summary}
        regenerating={regenerating}
        onRequestRegenerate={(): void => { setConfirmOpen(true); }}
      />

      <RegenerateConfirmModal
        isOpen={confirmOpen}
        currentGeneration={digest.generation}
        date={safeDate}
        onCancel={(): void => { setConfirmOpen(false); }}
        onConfirm={handleConfirmRegenerate}
        busy={regenerating}
      />
    </Layout>
  );
}
