import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Archive,
  Bell,
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock,
  Cog,
  FileText,
  HelpCircle,
  Link,
  ListTodo,
  Loader2,
  MoreVertical,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import type { Action, CommandType } from '@/types';
import type { ResolvedActionButton, ActionExecutionResult } from '@/types/actionConfig';
import { useActionConfig } from '@/hooks/useActionConfig';
import { ConfigurableActionButton } from './ConfigurableActionButton.js';

export interface ExecutionState {
  type: 'success' | 'error';
  message: string;
  resourceUrl?: string;
  linkLabel?: string;
  errorCode?: string;
  lastButton?: ResolvedActionButton;
  isDismissError?: boolean;
}

interface ActionItemProps {
  action: Action;
  onClick: () => void;
  onActionSuccess: (button: ResolvedActionButton) => void;
  onDismiss: (actionId: string) => Promise<void>;
  isDismissing?: boolean;
}

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

/**
 * Normalizes resourceUrl for HashRouter.
 * Backend returns URLs like "/#/research/..." but HashRouter's Link component
 * expects just "/research/..." (it handles the # prefix automatically).
 */
function normalizeResourceUrl(url: string): string {
  if (url.startsWith('/#')) {
    return url.slice(2);
  }
  if (url.startsWith('#')) {
    return url.slice(1);
  }
  return url;
}

export function ActionItem({
  action,
  onClick,
  onActionSuccess,
  onDismiss,
  isDismissing = false,
}: ActionItemProps): React.JSX.Element {
  const { buttons } = useActionConfig(action);
  const [executionState, setExecutionState] = useState<ExecutionState | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [localDismissing, setLocalDismissing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current !== null && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const primaryButton = buttons[0];
  const secondaryButtons = buttons.slice(1);

  const handleResult = (
    result: ActionExecutionResult,
    button: ResolvedActionButton,
    closeDropdown?: () => void
  ): void => {
    closeDropdown?.();
    if (result.status === 'completed') {
      setExecutionState({
        type: 'success',
        message: button.onSuccess?.message ?? 'Action completed!',
        ...(result.resourceUrl !== undefined && {
          resourceUrl: normalizeResourceUrl(result.resourceUrl),
        }),
        ...(button.onSuccess?.linkLabel !== undefined && {
          linkLabel: button.onSuccess.linkLabel,
        }),
      });
    } else {
      setExecutionState({
        type: 'error',
        message: result.message ?? 'Action failed',
        ...(result.errorCode !== undefined && { errorCode: result.errorCode }),
        lastButton: button,
      });
    }
  };

  const handleDismissPanel = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setExecutionState(null);
  };

  const handleDismissAction = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    setLocalDismissing(true);
    try {
      await onDismiss(action.id);
    } catch (err) {
      setExecutionState({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to archive action',
        isDismissError: true,
      });
    } finally {
      setLocalDismissing(false);
    }
  };

  const showDismissButton = action.status === 'completed' || action.status === 'failed';
  const isSuccess = executionState?.type === 'success';
  const showReconnectLink =
    executionState?.errorCode === 'TOKEN_ERROR' ||
    executionState?.errorCode === 'NOT_CONNECTED' ||
    executionState?.errorCode === 'UNAUTHORIZED';
  const actualDismissing = isDismissing || localDismissing;

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
        <div
          className="flex shrink-0 items-center gap-1"
          onClick={(e): void => {
            e.stopPropagation();
          }}
        >
          {primaryButton !== undefined && (
            <ConfigurableActionButton
              key={primaryButton.id}
              button={primaryButton}
              onSuccess={(): void => {
                onActionSuccess(primaryButton);
              }}
              onResult={(result, btn): void => {
                handleResult(result, btn);
              }}
              onError={(err): void => {
                setExecutionState({
                  type: 'error',
                  message: err.message,
                  lastButton: primaryButton,
                });
              }}
            />
          )}

          <div className="hidden gap-1 sm:flex">
            {secondaryButtons.map((button) => (
              <ConfigurableActionButton
                key={button.id}
                button={button}
                onSuccess={(): void => {
                  onActionSuccess(button);
                }}
                onResult={(result, btn): void => {
                  handleResult(result, btn);
                }}
                onError={(err): void => {
                  setExecutionState({
                    type: 'error',
                    message: err.message,
                    lastButton: button,
                  });
                }}
              />
            ))}
            {showDismissButton && (
              <button
                onClick={(e): void => {
                  void handleDismissAction(e);
                }}
                disabled={actualDismissing}
                className="rounded px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                title="Archive action"
              >
                {actualDismissing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Dismiss'}
              </button>
            )}
          </div>

          {(secondaryButtons.length > 0 || showDismissButton) && (
            <div className="relative sm:hidden" ref={dropdownRef}>
              <button
                onClick={(): void => {
                  setIsDropdownOpen((prev) => !prev);
                }}
                className="rounded p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="More actions"
              >
                <MoreVertical className="h-4 w-4" />
              </button>

              {isDropdownOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 min-w-[140px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  {secondaryButtons.map((button) => (
                    <ConfigurableActionButton
                      key={button.id}
                      button={button}
                      variant="dropdown"
                      onSuccess={(): void => {
                        setIsDropdownOpen(false);
                        onActionSuccess(button);
                      }}
                      onResult={(result, btn): void => {
                        handleResult(result, btn, () => {
                          setIsDropdownOpen(false);
                        });
                      }}
                      onError={(err): void => {
                        setIsDropdownOpen(false);
                        setExecutionState({
                          type: 'error',
                          message: err.message,
                          lastButton: button,
                        });
                      }}
                    />
                  ))}
                  {showDismissButton && (
                    <button
                      onClick={(e): void => {
                        setIsDropdownOpen(false);
                        void handleDismissAction(e);
                      }}
                      disabled={actualDismissing}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                    >
                      {actualDismissing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                      Dismiss
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {executionState !== null && (
        <div
          className={`mt-3 rounded-md border p-3 ${
            isSuccess ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
          }`}
          onClick={(e): void => {
            e.stopPropagation();
          }}
        >
          <div className="flex items-start gap-2">
            {isSuccess ? (
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-sm ${isSuccess ? 'text-green-800' : 'text-red-800'}`}>
                {executionState.message}
              </p>
              {isSuccess && executionState.resourceUrl !== undefined && (
                <RouterLink
                  to={executionState.resourceUrl}
                  className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-green-700 underline hover:text-green-800"
                >
                  {executionState.linkLabel ?? 'View'}
                  <ChevronRight className="h-3 w-3" />
                </RouterLink>
              )}
              {!isSuccess && showReconnectLink && (
                <RouterLink
                  to="/settings"
                  className="mt-1 block text-sm font-medium text-red-700 underline hover:text-red-800"
                >
                  {executionState.errorCode === 'NOT_CONNECTED' ? 'Connect Calendar' : 'Reconnect Calendar'}
                </RouterLink>
              )}
            </div>
            <button
              onClick={handleDismissPanel}
              className={`shrink-0 rounded p-1 transition-colors ${
                isSuccess
                  ? 'text-green-600 hover:bg-green-100 hover:text-green-800'
                  : 'text-red-600 hover:bg-red-100 hover:text-red-800'
              }`}
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
