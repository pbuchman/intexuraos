import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionDetailModal,
  CommandDetailModal,
  Button,
  Card,
  Layout,
  ConfigurableActionButton,
} from '@/components';
import { useAuth } from '@/context';
import { ApiError, archiveCommand, deleteCommand, getActions, getCommands } from '@/services';
import type { Action, Command, CommandType } from '@/types';
import type { ResolvedActionButton } from '@/types/actionConfig';
import { useActionConfig } from '@/hooks/useActionConfig';
import {
  Archive,
  Bell,
  Calendar,
  CheckCircle,
  Clock,
  FileText,
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
      return <Loader2 className={`${iconClass} text-blue-500 animate-spin`} />;
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
          <p className="line-clamp-3 text-sm text-slate-800">{command.text}</p>
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
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
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
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50"
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
}

function ActionItem({ action, onClick, onActionSuccess }: ActionItemProps): React.JSX.Element {
  const { buttons } = useActionConfig(action);

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
        <div className="mt-0.5 shrink-0">{getTypeIcon(action.type)}</div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-slate-800">{action.title}</h3>
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
        <div
          className="flex shrink-0 gap-1"
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
            />
          ))}
        </div>
      </div>
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

  useEffect(() => {
    localStorage.setItem('inbox-active-tab', activeTab);
  }, [activeTab]);

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
        const [commandsRes, actionsRes] = await Promise.all([
          getCommands(token),
          getActions(token),
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
    [getAccessToken]
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
      const response = await getActions(token, { cursor: actionsCursor });

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

  // Deep linking: open action modal from URL query parameter
  useEffect(() => {
    const hash = window.location.hash;
    const queryString = hash.includes('?') ? hash.split('?')[1] : '';
    if (queryString === '') {
      return;
    }

    const params = new URLSearchParams(queryString);
    const actionId = params.get('action');

    if (actionId !== null && actions.length > 0) {
      const action = actions.find((a) => a.id === actionId);
      if (action !== undefined) {
        setSelectedAction(action);
      }
    }
  }, [actions]);

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

      {/* Content */}
      <div className="space-y-3">
        {activeTab === 'actions' && (
          <>
            {actions.length === 0 ? (
              <Card title="">
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ListTodo className="mb-4 h-12 w-12 text-slate-300" />
                  <h3 className="text-lg font-medium text-slate-700">No actions yet</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Actions are created when commands are classified.
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
                    } else if (button.endpoint.method === 'PATCH') {
                      // If PATCH (archive, reject), refresh to get updated status
                      void fetchData(true);
                    }
                  }}
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
