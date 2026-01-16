import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  ActionDetailModal,
  CommandDetailModal,
  Button,
  Card,
  Layout,
  ConfigurableActionButton,
} from '@/components';
import { X } from 'lucide-react';
import { useAuth } from '@/context';
import {
  ApiError,
  archiveCommand,
  batchGetActions,
  deleteCommand,
  getActions,
  getCommands,
} from '@/services';
import type { Action, ActionStatus, Command, CommandType } from '@/types';
import type { ResolvedActionButton } from '@/types/actionConfig';
import { useActionConfig } from '@/hooks/useActionConfig';
import { useActionChanges } from '@/hooks/useActionChanges';
import { useCommandChanges } from '@/hooks/useCommandChanges';
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
  Radio,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';

type TabId = 'commands' | 'actions';

interface SuccessNotification {
  id: string;
  message: string;
  resourceUrl: string;
  linkLabel: string;
  timestamp: number;
  isNew: boolean;
}

interface ActionItemProps {
  action: Action;
  onClick: () => void;
  onActionSuccess: (button: ResolvedActionButton) => void;
  onExecutionResult: (result: {
    actionId: string;
    resourceUrl: string;
    message: string;
    linkLabel: string;
  }) => void;
  isFadingOut?: boolean;
}

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

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

interface ActionItemProps {
  action: Action;
  onClick: () => void;
  onActionSuccess: (button: ResolvedActionButton) => void;
  onExecutionResult: (result: {
    actionId: string;
    resourceUrl: string;
    message: string;
    linkLabel: string;
  }) => void;
  isFadingOut?: boolean;
}

function ActionItem({
  action,
  onClick,
  onActionSuccess,
  onExecutionResult,
  isFadingOut = false,
}: ActionItemProps): React.JSX.Element {
  const { buttons } = useActionConfig(action);
  const [actionExecuted, setActionExecuted] = useState(false);

  /**
   * Normalizes resource_url for HashRouter.
   * Backend returns URLs like "/#/research/..." but HashRouter's Link component
   * expects just "/research/..." (it handles the # prefix automatically).
   */
  const normalizeResourceUrl = (url: string): string => {
    if (url.startsWith('/#')) {
      return url.slice(2);
    }
    if (url.startsWith('#')) {
      return url.slice(1);
    }
    return url;
  };

  return (
    <div
      className={`cursor-pointer rounded-lg border border-slate-200 bg-white p-4 transition-[opacity,transform] duration-500 ease-out hover:border-slate-300 hover:shadow-sm ${
        isFadingOut ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}
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
        <div className="mt-0.5 shrink-0">{getTypeIcon(action.type)}</div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-medium text-slate-800">{action.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              {getTypeLabel(action.type)}
            </span>
            <span className="inline-flex items-center gap-1">
              {getStatusIcon(action.status)}
              {action.status}
            </span>
            <span>{String(Math.round(action.confidence * 100))}% confidence</span>
            <span>{formatDate(action.createdAt)}</span>
          </div>
        </div>
        {/* Hide buttons after action with resource_url was executed */}
        {!actionExecuted && (
          <div
            className="flex shrink-0 gap-1 flex-nowrap overflow-x-auto"
            onClick={(e): void => {
              e.stopPropagation();
            }}
          >
            {buttons.map((button) => (
              <ConfigurableActionButton
                key={button.id}
                button={button}
                onSuccess={(): void => {
                  onActionSuccess(button);
                }}
                onResult={(result, btn): void => {
                  if (result.resource_url !== undefined && btn.onSuccess !== undefined) {
                    onExecutionResult({
                      actionId: action.id,
                      resourceUrl: normalizeResourceUrl(result.resource_url),
                      message: btn.onSuccess.message,
                      linkLabel: btn.onSuccess.linkLabel,
                    });
                    setActionExecuted(true);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 💰 CostGuard: Debounce delay for batch fetching changed actions
const DEBOUNCE_DELAY_MS = 500;
// 💰 CostGuard: Max IDs per batch request (must match backend maxItems)
const BATCH_SIZE_LIMIT = 50;
// Fade out duration for actions that no longer match filter
const FADE_OUT_DURATION_MS = 5000;

interface NotificationAreaProps {
  notification: SuccessNotification | null;
  onDismiss: () => void;
}

function NotificationArea({ notification, onDismiss }: NotificationAreaProps): React.JSX.Element | null {
  if (notification === null) return null;

  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 transition-all sm:flex sm:items-center sm:justify-between ${
        notification.isNew
          ? 'border-green-300 bg-green-50 shadow-sm animate-in slide-in-from-top-2 fade-in-0 duration-300'
          : 'border-green-200 bg-green-50'
      }`}
    >
      <div className="flex items-start gap-3 sm:items-center">
        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-600 sm:mt-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-green-800">{notification.message}</p>
          <RouterLink
            to={notification.resourceUrl}
            className="mt-1 block text-sm font-medium text-green-700 underline hover:text-green-800 sm:mt-0 sm:inline"
            onClick={(e): void => {
              e.stopPropagation();
            }}
          >
            {notification.linkLabel}
          </RouterLink>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="ml-auto mt-2 shrink-0 self-start rounded p-1 text-green-600 transition-colors hover:bg-green-100 hover:text-green-800 sm:ml-0 sm:mt-0"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
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
  const [successNotification, setSuccessNotification] = useState<SuccessNotification | null>(null);
  const [fadingOutActionIds, setFadingOutActionIds] = useState<Set<string>>(new Set());
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
              s === 'failed'
          );
        }
      } catch {
        // Invalid JSON, use defaults
      }
    }
    // Default: show awaiting_approval and failed
    return ['awaiting_approval', 'failed'];
  });
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  // 💰 CostGuard: Real-time action listener - only enabled when Actions tab is active
  const {
    changedActionIds,
    error: actionListenerError,
    isListening: isActionsListening,
    clearChangedIds: clearActionChangedIds,
  } = useActionChanges(activeTab === 'actions');

  // 💰 CostGuard: Real-time command listener - only enabled when Commands tab is active
  const {
    changedCommandIds,
    error: commandListenerError,
    isListening: isCommandsListening,
    clearChangedIds: clearCommandChangedIds,
  } = useCommandChanges(activeTab === 'commands');

  const listenerError = activeTab === 'actions' ? actionListenerError : commandListenerError;
  const isListening = activeTab === 'actions' ? isActionsListening : isCommandsListening;

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
              if (matchesFilter) {
                updated[index] = changedAction;
              } else {
                updated.splice(index, 1);
              }
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

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Handle tab switching: save to localStorage, refresh data, and clear notifications
  useEffect(() => {
    localStorage.setItem('inbox-active-tab', activeTab);

    // Refresh data when switching tabs (but not on initial load)
    if (previousTabRef.current !== activeTab && !isLoadingRef.current) {
      void fetchData(true);
      // Clear success notification when switching tabs
      setSuccessNotification(null);
    }
    previousTabRef.current = activeTab;
  }, [activeTab, fetchData]);

  // Handle execution result: show global notification and initiate fade-out
  const handleExecutionResult = useCallback(
    (result: {
      actionId: string;
      resourceUrl: string;
      message: string;
      linkLabel: string;
    }): void => {
      // Set new notification with isNew flag for visual highlight
      const notificationId = `${result.actionId}-${String(Date.now())}`;
      setSuccessNotification({
        id: notificationId,
        message: result.message,
        resourceUrl: result.resourceUrl,
        linkLabel: result.linkLabel,
        timestamp: Date.now(),
        isNew: true,
      });

      // Remove isNew flag after animation duration for future notifications
      setTimeout(() => {
        setSuccessNotification((prev) =>
          prev?.id === notificationId ? { ...prev, isNew: false } : prev
        );
      }, 500);

      // Start fade-out for this action
      setFadingOutActionIds((prev) => new Set(prev).add(result.actionId));

      // Remove from list after fade-out duration
      setTimeout(() => {
        setActions((prev) => prev.filter((a) => a.id !== result.actionId));
        setFadingOutActionIds((prevSet) => {
          const newSet = new Set(prevSet);
          newSet.delete(result.actionId);
          return newSet;
        });
      }, FADE_OUT_DURATION_MS);
    },
    []
  );

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
          <div className="flex items-center gap-2">
            <p className="text-slate-600">Your commands and pending actions</p>
            {isListening && (
              <span className="inline-flex items-center gap-1 text-xs text-green-600">
                <Radio className="h-3 w-3 animate-pulse" />
                Live
              </span>
            )}
          </div>
        </div>
        <Button
          variant="secondary"
          onClick={handleRefresh}
          isLoading={isRefreshing}
          className="flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
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

      {/* Success notification area */}
      <NotificationArea
        notification={successNotification}
        onDismiss={(): void => {
          setSuccessNotification(null);
        }}
      />

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
                  onExecutionResult={handleExecutionResult}
                  isFadingOut={fadingOutActionIds.has(action.id)}
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
          onExecutionResult={handleExecutionResult}
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
