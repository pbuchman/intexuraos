import { AlertTriangle } from 'lucide-react';
import type { HellscriptEvent, HellscriptIntentKind } from '@/types';
import { formatDateTime } from '@/utils/dateFormat';

interface HellscriptTimelineProps {
  events: HellscriptEvent[];
}

const INTENT_BADGE_STYLES: Record<HellscriptIntentKind, string> = {
  append_thought:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  add_writing_sample:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  set_style_instructions:
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  set_metadata:
    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  delete_thought:
    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  reorder_thoughts:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  update_draft:
    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  fallback_append:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
};

function formatIntentLabel(kind: HellscriptIntentKind): string {
  return kind.replace(/_/g, ' ');
}


export function HellscriptTimeline({ events }: HellscriptTimelineProps): React.JSX.Element {
  if (events.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
        No events yet. Start by typing a thought below.
      </div>
    );
  }

  return (
    <div className="space-y-3 overflow-y-auto">
      {events.map((event) => {
        const isFallback = event.intent.kind === 'fallback_append';
        const isDraft = event.intent.kind === 'update_draft';

        return (
          <div
            key={event.id}
            className={`rounded-lg border px-3 py-2 ${
              isDraft
                ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                  INTENT_BADGE_STYLES[event.intent.kind]
                }`}
              >
                {formatIntentLabel(event.intent.kind)}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {formatDateTime(event.createdAt)}
              </span>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {event.rawUtterance}
            </p>
            {isFallback && event.intent.fallbackReason !== undefined ? (
              <div className="mt-1 flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                <AlertTriangle className="h-3 w-3" />
                <span>{event.intent.fallbackReason}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
