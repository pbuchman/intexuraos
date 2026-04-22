/**
 * Three collapsible panels displaying the GroupState snapshot:
 *   - Identity ledger
 *   - Open threads
 *   - Moderator events (historical)
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Users, FolderOpen, History } from 'lucide-react';
import { Card } from '@/components';
import type { GroupState } from '@/types/notificationDigests';

interface DigestStateProps {
  readonly state: GroupState;
}

interface PanelProps {
  readonly title: string;
  readonly count: number;
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
  readonly defaultExpanded?: boolean;
}

function Panel({ title, count, icon, children, defaultExpanded = false }: PanelProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      <button
        type="button"
        onClick={(): void => { setExpanded((v) => !v); }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {icon}
        <span className="font-medium text-slate-900 dark:text-slate-100">{title}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">({String(count)})</span>
      </button>
      {expanded ? (
        <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DigestState({ state }: DigestStateProps): React.JSX.Element {
  return (
    <Card className="mb-6">
      <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
        Stan grupy
      </h3>
      <div className="space-y-2">
        <Panel
          title="Księga tożsamości"
          count={state.identityLedger.length}
          icon={<Users className="h-4 w-4 text-blue-500" />}
        >
          {state.identityLedger.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Brak wpisów.</p>
          ) : (
            <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
              {state.identityLedger.map((entry) => (
                <li key={entry.sender} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{entry.sender}</span>
                  {entry.role !== undefined ? (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {entry.role}
                    </span>
                  ) : null}
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    od {entry.firstSeen} · {String(entry.totalMessages)} wiad. · {String(entry.activeDays)} dni
                  </span>
                  {entry.notes !== undefined && entry.notes !== '' ? (
                    <span className="w-full text-xs italic text-slate-500 dark:text-slate-400">{entry.notes}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Otwarte wątki"
          count={state.openThreads.length}
          icon={<FolderOpen className="h-4 w-4 text-amber-500" />}
        >
          {state.openThreads.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Brak otwartych wątków.</p>
          ) : (
            <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
              {state.openThreads.map((t, i) => (
                <li key={`${String(i)}-${t.topic}`}>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{t.topic}</span>
                  <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                    otwarto {t.openedOn} · ostatni sygnał {t.lastSignalDate}
                  </span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t.lastSignal}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Historia moderatora"
          count={state.moderatorEvents.length}
          icon={<History className="h-4 w-4 text-violet-500" />}
        >
          {state.moderatorEvents.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Brak zdarzeń.</p>
          ) : (
            <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
              {state.moderatorEvents.map((e, i) => (
                <li key={`${String(i)}-${e.date}-${e.topic}`}>
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{e.date}</span>
                  <span className="ml-2 font-medium text-slate-900 dark:text-slate-100">{e.topic}</span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{e.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Card>
  );
}
