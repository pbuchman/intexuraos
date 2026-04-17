/**
 * Threads section of the digest: one card per discussion topic with
 * participant chips, resolved/open pill, and expandable key facts list.
 */

import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, MessageCircle } from 'lucide-react';
import { Card } from '@/components';
import type { DigestThread } from '@/types/notificationDigests';

interface DigestThreadsProps {
  readonly threads: readonly DigestThread[];
}

function ThreadCard({ thread }: { thread: DigestThread }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hasKeyFacts = thread.keyFacts.length > 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-slate-900 dark:text-slate-100">{thread.topic}</h4>
          <div className="mt-1 flex flex-wrap gap-1">
            {thread.participants.map((name) => (
              <span
                key={name}
                className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
        <span
          className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            thread.resolved
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
          }`}
        >
          {thread.resolved ? <CheckCircle2 className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
          {thread.resolved ? 'Rozwiązany' : 'Otwarty'}
        </span>
      </div>
      {hasKeyFacts ? (
        <>
          <button
            type="button"
            onClick={(): void => { setExpanded((v) => !v); }}
            className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {expanded ? 'Ukryj fakty' : `Pokaż ${String(thread.keyFacts.length)} faktów`}
          </button>
          {expanded ? (
            <ul className="mt-2 space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200" style={{ listStyleType: 'disc' }}>
              {thread.keyFacts.map((fact, i) => (
                <li key={`${String(i)}-${fact.slice(0, 20)}`}>{fact}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function DigestThreads({ threads }: DigestThreadsProps): React.JSX.Element | null {
  if (threads.length === 0) return null;
  return (
    <Card className="mb-6">
      <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
        Wątki ({String(threads.length)})
      </h3>
      <div className="space-y-3">
        {threads.map((thread, i) => (
          <ThreadCard key={`${String(i)}-${thread.topic}`} thread={thread} />
        ))}
      </div>
    </Card>
  );
}
