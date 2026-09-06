import { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './ui/Button.js';
import { Modal } from '@/components/ui/Modal';
import type { ApiError } from '@/services/apiClient.js';
import { getErrorConfig } from '@/services/errorConfig.js';

interface TaskErrorModalProps {
  isOpen: boolean;
  error: ApiError | null;
  onClose: () => void;
  onRetry?: () => void;
}

export function TaskErrorModal({
  isOpen,
  error,
  onClose,
  onRetry,
}: TaskErrorModalProps): React.JSX.Element | null {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setShowDetails(false);
    }
  }, [isOpen]);

  if (error === null) return null;

  const config = getErrorConfig(error, {
    onClose,
    onRetry: onRetry ?? onClose,
    navigate: (path) => {
      window.location.href = path;
    },
  });
  const Icon = config.icon;
  const message = config.getMessage(error);

  const handlePrimaryAction = (): void => {
    // For retry action, call the onRetry callback
    if (config.primaryAction?.label === 'Try again' && onRetry !== undefined) {
      onRetry();
      return;
    }
    // For other actions, execute the configured action
    config.primaryAction?.getAction(error, {
      onClose,
      onRetry: onRetry ?? onClose,
      navigate: (path) => {
        window.location.href = path;
      },
    })();
  };

  const handleSecondaryAction = (): void => {
    // For close action, just close the modal
    if (config.secondaryAction?.label === 'Cancel' || config.secondaryAction?.label === 'Close') {
      onClose();
      return;
    }
    // For other actions, execute the configured action
    config.secondaryAction?.getAction(error, {
      onClose,
      onRetry: onRetry ?? onClose,
      navigate: (path) => {
        window.location.href = path;
      },
    })();
  };

  const details: Record<string, string> = {
    'Error code': error.code,
    'Status': error.status.toString(),
    'Message': error.message,
    ...(error.details ?? {}),
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open): void => {
        if (!open) onClose();
      }}
      title={config.title}
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800"
    >
        {/* Header */}
        <div
          className={`flex shrink-0 items-start justify-between border-b p-4 ${config.borderColor} dark:border-opacity-50`}
        >
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 rounded-lg p-2 ${config.bgColor} dark:bg-opacity-50`}>
              <Icon className={`h-5 w-5 ${config.iconColor}`} />
            </div>
            <div>
              <h2 id="error-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {config.title}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className={`rounded-lg border p-4 ${config.bgColor} ${config.borderColor} dark:border-opacity-50`}>
            <p id="error-modal-description" className={`text-sm ${config.iconColor}`}>
              {message}
            </p>
          </div>

          {/* Collapsible technical details */}
          {config.showDetails && (
            <div className="mt-4">
              <button
                onClick={(): void => {
                  setShowDetails((prev) => !prev);
                }}
                className="flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                aria-expanded={showDetails}
              >
                {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                Technical details
              </button>
              {showDetails && (
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(details).map(([key, value]) => (
                        <tr
                          key={key}
                          className="border-b border-slate-200 last:border-b-0 dark:border-slate-700"
                        >
                          <td className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">{key}</td>
                          <td className="px-3 py-2 font-mono text-slate-900 dark:text-slate-100 break-all">
                            {value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div
          className={`flex shrink-0 items-center justify-end gap-2 border-t p-4 ${config.borderColor} dark:border-opacity-50`}
        >
          {config.secondaryAction && (
            <Button variant="secondary" onClick={handleSecondaryAction}>
              {config.secondaryAction.label}
            </Button>
          )}
          <Button variant={config.primaryAction?.variant ?? 'secondary'} onClick={handlePrimaryAction}>
            {config.primaryAction?.label ?? 'Close'}
          </Button>
        </div>
    </Modal>
  );
}
