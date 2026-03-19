import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionDetailModal,
  ActionItem,
  Button,
  Card,
  CommandDetailModal,
  ErrorBanner,
  Layout,
} from '@/components';
import { CommandItem } from '@/components/inbox/CommandItem.js';
import { InboxFilters } from '@/components/inbox/InboxFilters.js';
import { useAuth } from '@/context';
import {
  ApiError,
  archiveCommand,
  batchGetActions,
  deleteCommand,
  getActions,
  getCommands,
} from '@/services';
import type { Action, ActionStatus, Command } from '@/types';
import type { ResolvedActionButton } from '@/types/actionConfig';
import { useActionChanges } from '@/hooks/useActionChanges';
import { useCommandChanges } from '@/hooks/useCommandChanges';
import {
  ArrowUpDown,
  Inbox,
  ListTodo,
  Loader2,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';

type TabId = 'commands' | 'actions';

type ActionSortKey = 'created' | 'status';
type CommandSortKey = 'created' | 'type';

const ACTION_SORT_OPTIONS: { key: ActionSortKey; label: string }[] = [
  { key: 'created', label: 'Newest' },
  { key: 'status', label: 'Status' },
];

const COMMAND_SORT_OPTIONS: { key: CommandSortKey; label: string }[] = [
  { key: 'created', label: 'Newest' },
  { key: 'type', label: 'Type' },
];

// 💰 CostGuard: Debounce delay for batch fetching changed actions
const DEBOUNCE_DELAY_MS = 500;
// 💰 CostGuard: Max IDs per batch request (must match backend maxItems)
const BATCH_SIZE_LIMIT = 50;

const STATUS_ORDER: Record<ActionStatus, number> = {
  pending: 0,
  awaiting_approval: 1,
  processing: 2,
  completed: 3,
  failed: 4,
  rejected: 5,
  archived: 6,
};

function getActionsCountByStatus(actions: Action[]): Record<ActionStatus, number> {
  const counts: Record<ActionStatus, number> = {
    pending: 0,
    awaiting_approval: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    rejected: 0,
    archived: 0,
  };
  for (const action of actions) {
    if (action.status in counts) {
      counts[action.status]++;
    }
  }
  return counts;
}

function sortActions(actions: Action[], sortKey: ActionSortKey): Action[] {
  const sorted = [...actions];
  if (sortKey === 'created') {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  if (sortKey === 'status') {
    sorted.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  }
  return sorted;
}

function sortCommands(commands: Command[], sortKey: CommandSortKey): Command[] {
  const sorted = [...commands];
  if (sortKey === 'created') {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  if (sortKey === 'type') {
    sorted.sort((a, b) => {
      const typeA = a.classification?.type ?? 'unknown';
      const typeB = b.classification?.type ?? 'unknown';
      return typeA.localeCompare(typeB);
    });
  }
  return sorted;
}

export function InboxPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const stored = localStorage.getItem('inbox-active-tab');
    return stored === 'actions' || stored === 'commands' ? stored : 'actions';
  });
  const [commands, setCommands] = useState<Command[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [commandsCursor, setCommandsCursor] = useState<string | undefined>(undefined);
  const [actionsCursor, setActionsCursor] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingCommandId, setDeletingCommandId] = useState<string | null>(null);
  const [archivingCommandId, setArchivingCommandId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<Command | null>(null);
  const [statusFilter, setStatusFilter] = useState<ActionStatus[]>(() => {
    const stored = localStorage.getItem('inbox-status-filter');
    if (stored !== null) {
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (s): s is ActionStatus =>
              s === 'awaiting_approval' ||
              s === 'approved' ||
              s === 'rejected' ||
              s === 'completed' ||
              s === 'failed' ||
              s === 'processing'
          );
        }
      } catch {
        // Invalid JSON, use defaults
      }
    }
    // Default: show awaiting_approval, failed, and processing
    return ['awaiting_approval', 'failed', 'processing'];
  });
  const [isFilterExpanded, setIsFilterExpanded] = useState(
    () => localStorage.getItem('inbox-filter-expanded') === 'true'
  );
  const [actionSort, setActionSort] = useState<ActionSortKey>(() => {
    const stored = localStorage.getItem('inbox-sort-actions');
    return stored === 'status' ? 'status' : 'created';
  });
  const [commandSort, setCommandSort] = useState<CommandSortKey>(() => {
    const stored = localStorage.getItem('inbox-sort-commands');
    return stored === 'type' ? 'type' : 'created';
  });

  // 💰 CostGuard: Real-time action listener - only enabled when Actions tab is active
  const {
    changedActionIds,
    error: actionListenerError,
    clearChangedIds: clearActionChangedIds,
  } = useActionChanges(activeTab === 'actions');

  // 💰 CostGuard: Real-time command listener - only enabled when Commands tab is active
  const {
    changedCommandIds,
    error: commandListenerError,
    clearChangedIds: clearCommandChangedIds,
  } = useCommandChanges(activeTab === 'commands');

  const listenerError = activeTab === 'actions' ? actionListenerError : commandListenerError;

  // Ref for debounce timeout
  const actionsDebounceTimeoutRef = useRef<number | null>(null);
  const commandsDebounceTimeoutRef = useRef<number | null>(null);

  const previousTabRef = useRef<TabId>(activeTab);
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  // 💰 CostGuard: Debounced batch fetch for changed actions
  const fetchChangedActions = useCallback(
    async (ids: string[]): Promise<void> => {
      if (ids.length === 0) return;

      try {
        const token = await getAccessToken();

        const allFetchedActions: Action[] = [];
        for (let i = 0; i < ids.length; i += BATCH_SIZE_LIMIT) {
          const chunk = ids.slice(i, i + BATCH_SIZE_LIMIT);
          const fetchedActions = await batchGetActions(token, chunk);
          allFetchedActions.push(...fetchedActions);
        }

        setActions((prev) => {
          const updated = [...prev];

          for (const changedAction of allFetchedActions) {
            const index = updated.findIndex((a) => a.id === changedAction.id);
            const matchesFilter =
              statusFilter.length === 0 || statusFilter.includes(changedAction.status);

            if (index >= 0) {
              updated[index] = changedAction;
            } else if (matchesFilter) {
              updated.unshift(changedAction);
            }
          }

          return updated;
        });

        clearActionChangedIds();
      } catch {
        /* Best-effort batch fetch - silent fail */
      }
    },
    [getAccessToken, clearActionChangedIds, statusFilter]
  );

  const fetchChangedCommands = useCallback(async (): Promise<void> => {
    try {
      const token = await getAccessToken();
      const response = await getCommands(token);
      setCommands(response.commands);
      setCommandsCursor(response.nextCursor);
      clearCommandChangedIds();
    } catch {
      /* Best-effort fetch - silent fail */
    }
  }, [getAccessToken, clearCommandChangedIds]);

  // 💰 CostGuard: Debounce effect for batch fetching actions
  useEffect(() => {
    if (changedActionIds.length === 0) return;

    if (actionsDebounceTimeoutRef.current !== null) {
      window.clearTimeout(actionsDebounceTimeoutRef.current);
    }

    actionsDebounceTimeoutRef.current = window.setTimeout(() => {
      void fetchChangedActions(changedActionIds);
    }, DEBOUNCE_DELAY_MS);

    return (): void => {
      if (actionsDebounceTimeoutRef.current !== null) {
        window.clearTimeout(actionsDebounceTimeoutRef.current);
      }
    };
  }, [changedActionIds, fetchChangedActions]);

  // 💰 CostGuard: Debounce effect for fetching changed commands
  useEffect(() => {
    if (changedCommandIds.length === 0) return;

    if (commandsDebounceTimeoutRef.current !== null) {
      window.clearTimeout(commandsDebounceTimeoutRef.current);
    }

    commandsDebounceTimeoutRef.current = window.setTimeout(() => {
      void fetchChangedCommands();
    }, DEBOUNCE_DELAY_MS);

    return (): void => {
      if (commandsDebounceTimeoutRef.current !== null) {
        window.clearTimeout(commandsDebounceTimeoutRef.current);
      }
    };
  }, [changedCommandIds, fetchChangedCommands]);

  const fetchData = useCallback(
    async (showRefreshing?: boolean): Promise<void> => {
      try {
        if (showRefreshing === true) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        setError(null);

        const token = await getAccessToken();
        const actionsOptions = statusFilter.length > 0 ? { status: statusFilter } : undefined;
        const [commandsRes, actionsRes] = await Promise.all([
          getCommands(token),
          getActions(token, actionsOptions),
        ]);

        setCommands(commandsRes.commands);
        setActions(actionsRes.actions);
        setCommandsCursor(commandsRes.nextCursor);
        setActionsCursor(actionsRes.nextCursor);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to fetch inbox data');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [getAccessToken, statusFilter]
  );

  const loadMoreCommands = async (): Promise<void> => {
    if (commandsCursor === undefined || isLoadingMore) return;

    try {
      setIsLoadingMore(true);
      const token = await getAccessToken();
      const response = await getCommands(token, { cursor: commandsCursor });

      setCommands((prev) => [...prev, ...response.commands]);
      setCommandsCursor(response.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load more commands');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const loadMoreActions = async (): Promise<void> => {
    if (actionsCursor === undefined || isLoadingMore) return;

    try {
      setIsLoadingMore(true);
      const token = await getAccessToken();
      const options: { cursor: string; status?: ActionStatus[] } = { cursor: actionsCursor };
      if (statusFilter.length > 0) {
        options.status = statusFilter;
      }
      const response = await getActions(token, options);

      setActions((prev) => [...prev, ...response.actions]);
      setActionsCursor(response.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load more actions');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleDeleteCommand = async (commandId: string): Promise<void> => {
    try {
      setDeletingCommandId(commandId);
      setError(null);
      const token = await getAccessToken();
      await deleteCommand(token, commandId);
      setCommands((prev) => prev.filter((c) => c.id !== commandId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete command');
    } finally {
      setDeletingCommandId(null);
    }
  };

  const handleArchiveCommand = async (commandId: string): Promise<void> => {
    try {
      setArchivingCommandId(commandId);
      setError(null);
      const token = await getAccessToken();
      const updatedCommand = await archiveCommand(token, commandId);
      setCommands((prev) => prev.map((c) => (c.id === commandId ? updatedCommand : c)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to archive command');
    } finally {
      setArchivingCommandId(null);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Handle tab switching: save to localStorage, refresh data, and clear notifications
  useEffect(() => {
    localStorage.setItem('inbox-active-tab', activeTab);

    if (previousTabRef.current !== activeTab && !isLoadingRef.current) {
      void fetchData(true);
    }
    previousTabRef.current = activeTab;
  }, [activeTab, fetchData]);

  // Handle status filter changes: save to localStorage and refresh data
  const statusFilterRef = useRef<ActionStatus[]>(statusFilter);
  useEffect(() => {
    localStorage.setItem('inbox-status-filter', JSON.stringify(statusFilter));

    if (
      statusFilterRef.current.length === statusFilter.length &&
      statusFilterRef.current.every((s, i) => s === statusFilter[i])
    ) {
      return;
    }
    statusFilterRef.current = statusFilter;

    if (!isLoadingRef.current) {
      void fetchData(true);
    }
  }, [statusFilter, fetchData]);

  // Persist action sort to localStorage
  useEffect(() => {
    localStorage.setItem('inbox-sort-actions', actionSort);
  }, [actionSort]);

  // Persist command sort to localStorage
  useEffect(() => {
    localStorage.setItem('inbox-sort-commands', commandSort);
  }, [commandSort]);

  const handleToggleStatus = useCallback((status: ActionStatus): void => {
    setStatusFilter((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }, []);

  const handleClearAllStatuses = useCallback((): void => {
    setStatusFilter([]);
  }, []);

  const handleToggleFilterExpanded = useCallback((): void => {
    setIsFilterExpanded((prev) => {
      localStorage.setItem('inbox-filter-expanded', String(!prev));
      return !prev;
    });
  }, []);

  // Deep linking: open action modal from URL query parameter
  useEffect(() => {
    const hash = window.location.hash;
    const queryString = hash.includes('?') ? hash.split('?')[1] : '';
    if (queryString === '') {
      return;
    }

    const params = new URLSearchParams(queryString);
    const actionId = params.get('action');

    if (actionId === null) {
      return;
    }

    const cleanHash = hash.split('?')[0] ?? '';
    window.history.replaceState(null, '', cleanHash !== '' ? cleanHash : window.location.pathname);

    const actionInList = actions.find((a) => a.id === actionId);
    if (actionInList !== undefined) {
      setSelectedAction(actionInList);
      return;
    }

    const fetchKey = `fetched-action-${actionId}`;
    if (sessionStorage.getItem(fetchKey) === 'true') {
      return;
    }
    sessionStorage.setItem(fetchKey, 'true');

    void (async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        const fetchedActions = await batchGetActions(token, [actionId]);
        const action = fetchedActions.find((a) => a.id === actionId);
        if (action !== undefined) {
          setSelectedAction(action);
        }
      } catch {
        // Action not found or fetch failed - silently ignore
      }
    })();
  }, [actions, getAccessToken]);

  const handleRefresh = (): void => {
    void fetchData(true);
  };

  const loadMoreRef = useRef<HTMLDivElement>(null);

  const currentCursor = activeTab === 'commands' ? commandsCursor : actionsCursor;
  const handleLoadMore = activeTab === 'commands' ? loadMoreCommands : loadMoreActions;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting === true && currentCursor !== undefined && !isLoadingMore) {
          void handleLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef !== null) {
      observer.observe(currentRef);
    }

    return (): void => {
      if (currentRef !== null) {
        observer.unobserve(currentRef);
      }
    };
  }, [currentCursor, isLoadingMore, handleLoadMore]);

  // Compute sorted and filtered actions
  const pendingCount = useMemo(() => actions.filter((a) => a.status === 'pending').length, [actions]);
  const sortedActions = useMemo(() => sortActions(actions, actionSort), [actions, actionSort]);

  // Compute sorted commands
  const sortedCommands = useMemo(() => sortCommands(commands, commandSort), [commands, commandSort]);

  // Compute counts by status for filter pills
  const actionsCountByStatus = useMemo(() => getActionsCountByStatus(actions), [actions]);

  // Header subtitle
  const headerSubtitle =
    activeTab === 'actions'
      ? `${String(actions.length)} actions · ${String(pendingCount)} pending`
      : `${String(commands.length)} commands`;

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Inbox</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{headerSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Real-time listener error warning */}
      {listenerError !== null && listenerError !== '' ? (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          Real-time updates paused: {listenerError}
        </div>
      ) : null}

      {/* Error Banner */}
      <ErrorBanner message={error} className="mb-6" />

      {/* Tabs */}
      <div className="mb-4 flex border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={(): void => {
            setActiveTab('actions');
          }}
          className={`flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'actions'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300'
          }`}
        >
          <ListTodo className="h-4 w-4" />
          Actions ({String(actions.length)})
        </button>
        <button
          onClick={(): void => {
            setActiveTab('commands');
          }}
          className={`flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'commands'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Commands ({String(commands.length)})
        </button>
      </div>

      {/* Status Filter for Actions */}
      {activeTab === 'actions' && (
        <InboxFilters
          statusFilter={statusFilter}
          isFilterExpanded={isFilterExpanded}
          onToggleStatus={handleToggleStatus}
          onToggleExpanded={handleToggleFilterExpanded}
          onClearAll={handleClearAllStatuses}
          actionsCountByStatus={actionsCountByStatus}
        />
      )}

      {/* Sort Selector */}
      {activeTab === 'actions' && (
        <div className="mb-4 flex items-center gap-2">
          <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">Sort</span>
          <div className="flex gap-1.5">
            {ACTION_SORT_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={(): void => {
                  setActionSort(key);
                }}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  actionSort === key
                    ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'commands' && (
        <div className="mb-4 flex items-center gap-2">
          <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">Sort</span>
          <div className="flex gap-1.5">
            {COMMAND_SORT_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={(): void => {
                  setCommandSort(key);
                }}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  commandSort === key
                    ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="space-y-3">
        {activeTab === 'actions' && (
          <>
            {sortedActions.length === 0 ? (
              <Card title="">
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ListTodo className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
                  <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300">
                    {statusFilter.length > 0 ? 'No matching actions' : 'No actions yet'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {statusFilter.length > 0
                      ? 'Try adjusting your filters or clear them to see all actions.'
                      : 'Actions are created when commands are classified.'}
                  </p>
                </div>
              </Card>
            ) : (
              sortedActions.map((action) => (
                <ActionItem
                  key={action.id}
                  action={action}
                  onClick={(): void => {
                    setSelectedAction(action);
                  }}
                  onActionSuccess={(button): void => {
                    if (button.endpoint.method === 'DELETE') {
                      setActions((prev) => prev.filter((a) => a.id !== button.action.id));
                    } else if (
                      button.endpoint.method === 'PATCH' ||
                      button.endpoint.method === 'POST'
                    ) {
                      void fetchData(true);
                    }
                  }}
                  onActionUpdated={(updatedAction: Action): void => {
                    setActions((prev) =>
                      prev.map((a) => (a.id === updatedAction.id ? updatedAction : a))
                    );
                  }}
                />
              ))
            )}
          </>
        )}

        {activeTab === 'commands' && (
          <>
            {sortedCommands.length === 0 ? (
              <Card title="">
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Inbox className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
                  <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300">No commands yet</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Send a text or voice message via WhatsApp to create a command.
                  </p>
                </div>
              </Card>
            ) : (
              sortedCommands.map((command) => (
                <CommandItem
                  key={command.id}
                  command={command}
                  onClick={(): void => {
                    setSelectedCommand(command);
                  }}
                  onDelete={(id): void => {
                    void handleDeleteCommand(id);
                  }}
                  onArchive={(id): void => {
                    void handleArchiveCommand(id);
                  }}
                  isDeleting={deletingCommandId === command.id}
                  isArchiving={archivingCommandId === command.id}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* Infinite scroll sentinel */}
      {currentCursor !== undefined && (
        <div ref={loadMoreRef} className="flex h-16 items-center justify-center">
          {isLoadingMore && <Loader2 className="h-6 w-6 animate-spin text-blue-600" />}
        </div>
      )}

      {/* Action Detail Modal */}
      {selectedAction !== null && (
        <ActionDetailModal
          action={selectedAction}
          command={commands.find((c) => c.id === selectedAction.commandId)}
          onClose={(): void => {
            setSelectedAction(null);
          }}
          onActionSuccess={(button: ResolvedActionButton): void => {
            if (button.endpoint.method === 'DELETE') {
              setActions((prev) => prev.filter((a) => a.id !== button.action.id));
            }
            setSelectedAction(null);
          }}
          onActionUpdated={(updatedAction: Action): void => {
            setActions((prev) => prev.map((a) => (a.id === updatedAction.id ? updatedAction : a)));
            setSelectedAction(updatedAction);
          }}
        />
      )}

      {/* Command Detail Modal */}
      {selectedCommand !== null && (
        <CommandDetailModal
          command={selectedCommand}
          onClose={(): void => {
            setSelectedCommand(null);
          }}
        />
      )}
    </Layout>
  );
}
