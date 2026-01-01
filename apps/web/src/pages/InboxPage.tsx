import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { ApiError, getActions, getCommands } from '@/services';
import type { Action, Command, CommandType } from '@/types';
import {
  CheckCircle,
  Clock,
  FileText,
  Inbox,
  Link,
  ListTodo,
  MessageSquare,
  Mic,
  RefreshCw,
  Search,
  Calendar,
  Bell,
  HelpCircle,
  XCircle,
  Loader2,
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
      return <Clock className={`${iconClass} text-amber-500`} />;
    case 'processing':
      return <Loader2 className={`${iconClass} text-blue-500 animate-spin`} />;
    case 'failed':
      return <XCircle className={`${iconClass} text-red-500`} />;
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

function CommandItem({ command }: { command: Command }): React.JSX.Element {
  const isVoice = command.sourceType === 'whatsapp_voice';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-sm">
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
      </div>
    </div>
  );
}

function ActionItem({ action }: { action: Action }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-sm">
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
      </div>
    </div>
  );
}

export function InboxPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('commands');
  const [commands, setCommands] = useState<Command[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [commandsCursor, setCommandsCursor] = useState<string | undefined>(undefined);
  const [actionsCursor, setActionsCursor] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleRefresh = (): void => {
    void fetchData(true);
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  const currentCursor = activeTab === 'commands' ? commandsCursor : actionsCursor;
  const handleLoadMore = activeTab === 'commands' ? loadMoreCommands : loadMoreActions;

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
      </div>

      {/* Content */}
      <div className="space-y-3">
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
              commands.map((command) => <CommandItem key={command.id} command={command} />)
            )}
          </>
        )}

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
              actions.map((action) => <ActionItem key={action.id} action={action} />)
            )}
          </>
        )}
      </div>

      {/* Load more button */}
      {currentCursor !== undefined ? (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            onClick={(): void => {
              void handleLoadMore();
            }}
            isLoading={isLoadingMore}
          >
            Load More
          </Button>
        </div>
      ) : null}
    </Layout>
  );
}
