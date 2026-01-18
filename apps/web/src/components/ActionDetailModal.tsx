import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { Action, Command, CommandType } from '@/types';
import type { ResolvedActionButton, ActionExecutionResult } from '@/types/actionConfig';
import {
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  HelpCircle,
  Link,
  Loader2,
  ListTodo,
  Search,
  X,
} from 'lucide-react';
import { useActionConfig } from '@/hooks/useActionConfig';
import { ConfigurableActionButton } from './ConfigurableActionButton';
import { Button } from './ui/Button';
import { useAuth } from '@/context/AuthContext';
import { updateAction, resolveDuplicateAction } from '@/services/commandsApi';
import { BookmarkConflictModal } from './BookmarkConflictModal';

interface ActionDetailModalProps {
  action: Action;
  command: Command | undefined;
  onClose: () => void;
  onActionSuccess: (button: ResolvedActionButton) => void;
  onActionUpdated?: (action: Action) => void;
  onExecutionResult?: (result: {
    actionId: string;
    resourceUrl: string;
    message: string;
    linkLabel: string;
  }) => void;
}

const ACTION_TYPES: CommandType[] = [
  'todo',
  'research',
  'note',
  'link',
  'calendar',
  'reminder',
  'linear',
];

function getTypeIcon(type: CommandType): React.JSX.Element {
  const iconClass = 'h-5 w-5';
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

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ActionDetailModal({
  action,
  command,
  onClose,
  onActionSuccess,
  onActionUpdated,
  onExecutionResult,
}: ActionDetailModalProps): React.JSX.Element {
  const { buttons, isLoading } = useActionConfig(action);
  const { getAccessToken } = useAuth();
  const [executionResult, setExecutionResult] = useState<{
    actionId: string;
    status: 'completed' | 'failed' | 'rejected';
    resourceUrl?: string;
    message?: string;
    linkLabel?: string;
    errorCode?: string;
  } | null>(null);
  const [selectedType, setSelectedType] = useState<CommandType>(action.type);
  const [isChangingType, setIsChangingType] = useState(false);
  const [typeChangeError, setTypeChangeError] = useState<string | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  // Track if current action result has resource_url (used to prevent modal close)
  const hasResourceUrlRef = useRef(false);
  // Conflict modal state for duplicate bookmarks
  const [conflictInfo, setConflictInfo] = useState<{
    url: string;
    existingBookmarkId: string;
  } | null>(null);

  const canChangeType = action.status === 'pending' || action.status === 'awaiting_approval';

  const handleTypeChange = useCallback(
    async (newType: CommandType): Promise<void> => {
      if (newType === selectedType) return;

      setIsChangingType(true);
      setTypeChangeError(null);
      try {
        const token = await getAccessToken();
        const updatedAction = await updateAction(token, action.id, { type: newType });
        setSelectedType(newType);
        onActionUpdated?.(updatedAction);
      } catch (error) {
        setTypeChangeError(error instanceof Error ? error.message : 'Failed to change type');
        // Revert selection
        setSelectedType(action.type);
      } finally {
        setIsChangingType(false);
      }
    },
    [getAccessToken, action.id, action.type, onActionUpdated, selectedType]
  );

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return (): void => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  /**
   * Normalizes resource_url for HashRouter.
   * Backend returns URLs like "/#/research/..." but HashRouter's Link component
   * expects just "/research/..." (it handles the # prefix automatically).
   */
  const normalizeResourceUrl = (url: string): string => {
    // Strip leading /# or # prefix if present
    if (url.startsWith('/#')) {
      return url.slice(2);
    }
    if (url.startsWith('#')) {
      return url.slice(1);
    }
    return url;
  };

  const handleResult = (result: ActionExecutionResult, button: ResolvedActionButton): void => {
    // Check for duplicate bookmark conflict
    if (result.existingBookmarkId !== undefined) {
      const urlFromPayload = typeof action.payload['url'] === 'string' ? action.payload['url'] : action.title;
      setConflictInfo({
        url: urlFromPayload,
        existingBookmarkId: result.existingBookmarkId,
      });
      return;
    }

    // Handle success case (completed with resourceUrl)
    if (result.status === 'completed' && result.resourceUrl !== undefined) {
      const normalizedUrl = normalizeResourceUrl(result.resourceUrl);
      const message = button.onSuccess?.message ?? 'Action completed successfully';
      const linkLabel = button.onSuccess?.linkLabel ?? `Open ${action.type}`;

      // Report execution result to parent for global notification
      onExecutionResult?.({
        actionId: result.actionId,
        resourceUrl: normalizedUrl,
        message,
        linkLabel,
      });

      setExecutionResult({
        actionId: result.actionId,
        status: result.status,
        resourceUrl: normalizedUrl,
        message,
        linkLabel,
      });
      return;
    }

    // Handle failure case
    if (result.status === 'failed') {
      setExecutionResult({
        actionId: result.actionId,
        status: 'failed',
        message: result.message ?? 'Action failed',
        ...(result.errorCode !== undefined && { errorCode: result.errorCode }),
      });
    }
  };

  const handleSkipConflict = useCallback(async (): Promise<void> => {
    if (conflictInfo === null) return;
    try {
      const token = await getAccessToken();
      await resolveDuplicateAction(token, action.id, 'skip');
      onActionUpdated?.({ ...action, status: 'rejected' });
      setConflictInfo(null);
      onClose();
    } catch {
      // Error handled by modal
    }
  }, [conflictInfo, action, getAccessToken, onActionUpdated, onClose]);

  const handleUpdateConflict = useCallback(async (): Promise<void> => {
    if (conflictInfo === null) return;
    try {
      const token = await getAccessToken();
      const result = await resolveDuplicateAction(token, action.id, 'update');
      onActionUpdated?.({
        ...action,
        status: result.status,
        payload: {
          ...action.payload,
          resource_url: result.resourceUrl,
        },
      });
      setConflictInfo(null);
      // Show success view
      if (result.resourceUrl !== undefined) {
        setExecutionResult({
          actionId: result.actionId,
          status: result.status,
          resourceUrl: normalizeResourceUrl(result.resourceUrl),
        });
      }
    } catch {
      // Error handled by modal
    }
  }, [conflictInfo, action, getAccessToken, onActionUpdated]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-slate-100 p-2">{getTypeIcon(selectedType)}</div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{action.title}</h2>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                {canChangeType ? (
                  <div className="relative inline-flex items-center">
                    <select
                      value={selectedType}
                      onChange={(e): void => {
                        void handleTypeChange(e.target.value as CommandType);
                      }}
                      disabled={isChangingType}
                      className="appearance-none rounded-full border border-slate-200 bg-slate-100 py-0.5 pl-2 pr-6 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {ACTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {getTypeLabel(t)}
                        </option>
                      ))}
                    </select>
                    {isChangingType && (
                      <Loader2 className="absolute right-1.5 h-3 w-3 animate-spin text-slate-400" />
                    )}
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                    {getTypeLabel(selectedType)}
                  </span>
                )}
                <span>{String(Math.round(action.confidence * 100))}% confidence</span>
              </div>
              {typeChangeError !== null && (
                <p className="mt-1 text-xs text-red-600">{typeChangeError}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {/* Original command text */}
          {command !== undefined && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Original Command
              </h3>
              <div className="break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                {command.text}
              </div>
            </div>
          )}

          {/* Classification reasoning */}
          {command?.classification?.reasoning !== undefined && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Classification Reasoning
              </h3>
              <div className="break-words rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
                {command.classification.reasoning}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <span>Created {formatDate(action.createdAt)}</span>
            </div>
            {action.updatedAt !== action.createdAt && (
              <div className="flex items-center gap-1">
                <span>Updated {formatDate(action.updatedAt)}</span>
              </div>
            )}
          </div>

          {/* Status badge */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-sm font-medium text-slate-600">
              Status:{' '}
              <span
                className={
                  action.status === 'completed'
                    ? 'text-green-600'
                    : action.status === 'processing'
                      ? 'text-blue-600'
                      : action.status === 'failed' || action.status === 'rejected'
                        ? 'text-red-600'
                        : 'text-slate-600'
                }
              >
                {action.status.charAt(0).toUpperCase() + action.status.slice(1)}
              </span>
            </span>
          </div>
        </div>

        {/* Actions, Success View, or Error View */}
        {executionResult !== null && executionResult.status === 'completed' ? (
          <div className="shrink-0 border-t border-slate-200 p-4">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                <div className="flex-1">
                  <h4 className="font-medium text-green-800">
                    {executionResult.message ?? 'Action completed successfully'}
                  </h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <RouterLink
                      to={executionResult.resourceUrl ?? '#'}
                      className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {executionResult.linkLabel ?? `Open ${action.type}`}
                    </RouterLink>
                    <Button variant="secondary" onClick={onClose}>
                      Close
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : executionResult !== null && executionResult.status === 'failed' ? (
          <div className="shrink-0 border-t border-slate-200 p-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <X className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div className="flex-1">
                  <h4 className="font-medium text-red-800">
                    {executionResult.message ?? 'Action failed'}
                  </h4>
                  {(executionResult.errorCode === 'TOKEN_ERROR' || executionResult.errorCode === 'NOT_CONNECTED') && (
                    <RouterLink
                      to="/settings"
                      className="mt-2 block text-sm font-medium text-red-700 underline hover:text-red-800"
                    >
                      {executionResult.errorCode === 'NOT_CONNECTED' ? 'Connect Calendar' : 'Reconnect Calendar'}
                    </RouterLink>
                  )}
                  <div className="mt-3">
                    <Button variant="secondary" onClick={onClose}>
                      Close
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="shrink-0 border-t border-slate-200 p-4">
            {executionError !== null && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-600">{executionError}</p>
              </div>
            )}
            <div className="flex flex-nowrap items-center justify-end gap-2">
            {isLoading ? (
              <div className="text-sm text-slate-500">Loading actions...</div>
            ) : (
              buttons.map((button) => (
                <ConfigurableActionButton
                  key={button.id}
                  button={button}
                  onSuccess={(): void => {
                    // Note: onResult is called before onSuccess, but React state
                    // updates are batched, so executionResult may not be updated yet.
                    // The hasResourceUrl ref tells us if we should stay open.
                    if (!hasResourceUrlRef.current) {
                      onActionSuccess(button);
                    }
                    hasResourceUrlRef.current = false; // Reset for next action
                  }}
                  onResult={(result, btn): void => {
                    handleResult(result, btn);
                    // Keep modal open for results with resourceUrl or failed status
                    hasResourceUrlRef.current = result.resourceUrl !== undefined || result.status === 'failed';
                  }}
                  onError={(err): void => {
                    setExecutionError(err.message);
                  }}
                />
              ))
            )}
            </div>
          </div>
        )}
      </div>

      {/* Conflict Modal */}
      {conflictInfo !== null && (
        <BookmarkConflictModal
          isOpen
          url={conflictInfo.url}
          onSkip={(): void => {
            void handleSkipConflict();
          }}
          onUpdate={async (): Promise<void> => {
            await handleUpdateConflict();
          }}
          onClose={(): void => {
            setConflictInfo(null);
          }}
        />
      )}
    </div>
  );
}
