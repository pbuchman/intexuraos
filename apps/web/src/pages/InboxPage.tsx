import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionDetailModal,
  ActionItem,
  CommandDetailModal,
  Card,
  Layout,
} from '@/components';
import { useAuth } from '@/context';
import {
  ApiError,
  archiveAction,
  archiveCommand,
  batchGetActions,
  deleteCommand,
  getActions,
  getCommands,
} from '@/services';
import type { Action, ActionStatus, Command, CommandType } from '@/types';
import type { ResolvedActionButton } from '@/types/actionConfig';
import { useActionChanges } from '@/hooks/useActionChanges';
import { useCommandChanges } from '@/hooks/useCommandChanges';
import { formatDate } from '@/utils/dateFormat';
import {
  Archive,
  Bell,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Cog,
  FileText,
  Filter,
  HelpCircle,
  Inbox,
  Link,
  ListTodo,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';

type TabId = 'commands' | 'actions';

const ALL_ACTION_STATUSES: ActionStatus[] = [
  'pending',
  'awaiting_approval',
  'processing',
  'completed',
  'failed',
  'rejected',
  'archived',
];

const STATUS_LABELS: Record<ActionStatus, string> = {
  pending: 'Pending',
  awaiting_approval: 'Awaiting Approval',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Rejected',
  archived: 'Archived',
};

function getTypeIcon(type: CommandType): React.JSX.Element {
  const iconClass = 'h-4 w-4';
  switch (type) {
    case 'todo':
      return <ListTodo className={iconClass} />;
    case 'research':
      return <Search className={iconClass} />;
    case 'note':
      return <FileText className={iconClass} />;
    case 'link':
      return <Link className={iconClass} />;
    case 'calendar':
      return <Calendar className={iconClass} />;
    case 'reminder':
      return <Bell className={iconClass} />;
    default:
      return <HelpCircle className={iconClass} />;
  }
}

function getTypeLabel(type: CommandType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function getStatusIcon(status: string): React.JSX.Element {
  const iconClass = 'h-4 w-4';
  switch (status) {
    case 'completed':
    case 'classified':
      return <CheckCircle className={`${iconClass} text-green-500`} />;
    case 'pending':
    case 'received':
    case 'pending_classification':
      return <Clock className={`${iconClass} text-amber-500`} />;
    case 'processing':
      return <Cog className={`${iconClass} text-blue-500`} />;
    case 'failed':
    case 'rejected':
      return <XCircle className={`${iconClass} text-red-500`} />;
    case 'archived':
      return <Archive className={`${iconClass} text-slate-400`} />;
    default:
      return <HelpCircle className={`${iconClass} text-slate-400`} />;
  }
}

interface CommandItemProps {
  command: Command;
  onClick: () => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  isDeleting: boolean;
  isArchiving: boolean;
}

function CommandItem({
  command,
  onClick,
  onDelete,
  onArchive,
  isDeleting,
  isArchiving,
}: CommandItemProps): React.JSX.Element {
  const isVoice = command.sourceType === 'whatsapp_voice';
  const deletableStatuses = ['received', 'pending_classification', 'failed'];
  const canDelete = deletableStatuses.includes(command.status);
  const canArchive = command.status === 'classified';

  return (
    <div
      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-sm"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {isVoice ? (
            <Mic className="h-5 w-5 text-purple-500" />
          ) : (
            <MessageSquare className="h-5 w-5 text-blue-500" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 break-words text-sm text-slate-800">{command.text}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {command.classification !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                {getTypeIcon(command.classification.type)}
                {getTypeLabel(command.classification.type)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              {getStatusIcon(command.status)}
              {command.status}
            </span>
            <span>{formatDate(command.createdAt)}</span>
          </div>
        </div>
        <div
          className="flex shrink-0 gap-2"
          onClick={(e): void => {
            e.stopPropagation();
          }}
        >
          {canDelete && (
            <button
              onClick={(): void => {
                onDelete(command.id);
              }}
              disabled={isDeleting}
              className="rounded p-2.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              title="Delete command"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          )}
          {canArchive && (
            <button
              onClick={(): void => {
                onArchive(command.id);
              }}
              disabled={isArchiving}
              className="rounded p-2.5 text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50"
              title="Archive command"
            >
              {isArchiving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 💰 CostGuard: Debounce delay for batch fetching changed actions
const DEBOUNCE_DELAY_MS = 500;
// 💰 CostGuard: Max IDs per batch request (must match backend maxItems)
const BATCH_SIZE_LIMIT = 50;

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
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

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
  // Waits 500ms for additional changes before making API call
  // Chunks IDs into batches of BATCH_SIZE_LIMIT to respect backend limits
  const fetchChangedActions = useCallback(
    async (ids: string[]): Promise<void> => {
      if (ids.length === 0) return;

      try {
        const token = await getAccessToken();

        // Chunk IDs into batches of BATCH_SIZE_LIMIT
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
              // Manual acknowledgment model: always update the action in place
              // even if it no longer matches the filter. User must explicitly
              // dismiss (archive) to remove from list.
              updated[index] = changedAction;
            } else if (matchesFilter) {
              // Only add new actions that match the current filter
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

  // 💰 CostGuard: Fetch changed commands by refreshing the list
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

  const handleDismissAction = async (actionId: string): Promise<void> => {
    const token = await getAccessToken();
    await archiveAction(token, actionId);
    setActions((prev) => prev.filter((a) => a.id !== actionId));
  };

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Handle tab switching: save to localStorage, refresh data, and clear notifications
  useEffect(() => {
    localStorage.setItem('inbox-active-tab', activeTab);

    // Refresh data when switching tabs (but not on initial load)
    if (previousTabRef.current !== activeTab && !isLoadingRef.current) {
      void fetchData(true);
    }
    previousTabRef.current = activeTab;
  }, [activeTab, fetchData]);

  // Handle status filter changes: save to localStorage and refresh data
  const statusFilterRef = useRef<ActionStatus[]>(statusFilter);
  useEffect(() => {
    // Always persist filter state to localStorage
    localStorage.setItem('inbox-status-filter', JSON.stringify(statusFilter));

    // Skip refetch if filter hasn't changed (prevents double fetch on mount)
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

  const handleToggleStatus = (status: ActionStatus): void => {
    setStatusFilter((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  // Deep linking: open action modal from URL query parameter
  // When filters are active, the action may not be in the displayed list, so fetch it directly
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

    // Clean up URL immediately to prevent modal reappearing on refresh
    const cleanHash = hash.split('?')[0] ?? '';
    window.history.replaceState(null, '', cleanHash !== '' ? cleanHash : window.location.pathname);

    // First check if action is in current list (fast path)
    const actionInList = actions.find((a) => a.id === actionId);
    if (actionInList !== undefined) {
      setSelectedAction(actionInList);
      return;
    }

    // If not found and we haven't tried fetching yet, fetch directly
    // Use sessionStorage to track attempted fetches to avoid loops
    const fetchKey = `fetched-action-${actionId}`;
    if (sessionStorage.getItem(fetchKey) === 'true') {
      return;
    }
    sessionStorage.setItem(fetchKey, 'true');

    // Fetch the specific action even if it doesn't match current filters
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Inbox</h2>
          <p className="text-slate-600">Your commands and pending actions</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Real-time listener error warning */}
      {listenerError !== null && listenerError !== '' ? (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700">
          Real-time updates paused: {listenerError}
        </div>
      ) : null}

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {/* Tabs */}
      <div className="mb-4 flex border-b border-slate-200">
        <button
          onClick={(): void => {
            setActiveTab('actions');
          }}
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'actions'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
        >
          <ListTodo className="h-4 w-4" />
          Actions ({String(actions.length)})
        </button>
        <button
          onClick={(): void => {
            setActiveTab('commands');
          }}
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'commands'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Commands ({String(commands.length)})
        </button>
      </div>

      {/* Status Filter for Actions */}
      {activeTab === 'actions' && (
        <div className="mb-4">
          <button
            onClick={(): void => {
              setIsFilterExpanded((prev) => !prev);
            }}
            className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-800"
          >
            <Filter className="h-4 w-4" />
            Filter by status
            {statusFilter.length > 0 && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                {String(statusFilter.length)}
              </span>
            )}
            {isFilterExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {isFilterExpanded && (
            <div className="mt-3 flex flex-wrap gap-2">
              {ALL_ACTION_STATUSES.map((status) => (
                <label
                  key={status}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    statusFilter.includes(status)
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={statusFilter.includes(status)}
                    onChange={(): void => {
                      handleToggleStatus(status);
                    }}
                    className="sr-only"
                  />
                  {getStatusIcon(status)}
                  {STATUS_LABELS[status]}
                </label>
              ))}
              {statusFilter.length > 0 && (
                <button
                  onClick={(): void => {
                    setStatusFilter([]);
                  }}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="space-y-3">
        {activeTab === 'actions' && (
          <>
            {actions.length === 0 ? (
              <Card title="">
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ListTodo className="mb-4 h-12 w-12 text-slate-300" />
                  <h3 className="text-lg font-medium text-slate-700">
                    {statusFilter.length > 0 ? 'No matching actions' : 'No actions yet'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {statusFilter.length > 0
                      ? 'Try adjusting your filters or clear them to see all actions.'
                      : 'Actions are created when commands are classified.'}
                  </p>
                </div>
              </Card>
            ) : (
              actions.map((action) => (
                <ActionItem
                  key={action.id}
                  action={action}
                  onClick={(): void => {
                    setSelectedAction(action);
                  }}
                  onActionSuccess={(button): void => {
                    // If action is DELETE, remove from local state
                    if (button.endpoint.method === 'DELETE') {
                      setActions((prev) => prev.filter((a) => a.id !== button.action.id));
                    } else if (
                      button.endpoint.method === 'PATCH' ||
                      button.endpoint.method === 'POST'
                    ) {
                      // If PATCH (archive, reject) or POST (approve, retry), refresh to get updated status
                      void fetchData(true);
                    }
                  }}
                  onActionUpdated={(updatedAction: Action): void => {
                    setActions((prev) =>
                      prev.map((a) => (a.id === updatedAction.id ? updatedAction : a))
                    );
                  }}
                  onDismiss={handleDismissAction}
                />
              ))
            )}
          </>
        )}

        {activeTab === 'commands' && (
          <>
            {commands.length === 0 ? (
              <Card title="">
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Inbox className="mb-4 h-12 w-12 text-slate-300" />
                  <h3 className="text-lg font-medium text-slate-700">No commands yet</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Send a text or voice message via WhatsApp to create a command.
                  </p>
                </div>
              </Card>
            ) : (
              commands.map((command) => (
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
            // If action is DELETE, remove from local state
            if (button.endpoint.method === 'DELETE') {
              setActions((prev) => prev.filter((a) => a.id !== button.action.id));
            }
            // Close modal after action completes
            setSelectedAction(null);
          }}
          onActionUpdated={(updatedAction: Action): void => {
            // Update action in local state
            setActions((prev) => prev.map((a) => (a.id === updatedAction.id ? updatedAction : a)));
            // Update selected action to reflect changes
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
