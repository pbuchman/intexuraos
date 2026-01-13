/**
 * Configurable action button component.
 * Renders action buttons based on configuration.
 */

import { useState } from 'react';
import {
  Archive,
  CheckCircle,
  Trash2,
  XCircle,
  Sparkles,
  Play,
  FileText,
  ListTodo,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import type { ResolvedActionButton, ActionExecutionResult } from '../types/actionConfig';
import { executeAction } from '../services/actionExecutor';
import { useApiClient } from '../hooks/useApiClient';
import { config } from '../config';

interface ConfigurableActionButtonProps {
  button: ResolvedActionButton;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  /** Called with execution result when action completes (may include resource_url) */
  onResult?: (result: ActionExecutionResult, button: ResolvedActionButton) => void;
}

// Icon mapping for dynamic icon rendering
const ICON_MAP: Record<string, LucideIcon> = {
  Archive,
  CheckCircle,
  Trash2,
  XCircle,
  Sparkles,
  Play,
  FileText,
  ListTodo,
};

/**
 * Gets the icon component for a given icon name.
 *
 * @param iconName - Icon name from configuration
 * @returns Icon component or fallback
 */
function getIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? Trash2;
}

/**
 * Gets the button style classes based on variant.
 *
 * @param variant - Button variant
 * @returns Tailwind CSS classes
 */
function getButtonClasses(variant: 'primary' | 'secondary' | 'danger' | 'success'): string {
  // Mobile: full-width with larger padding, Desktop: inline with normal padding
  const baseClasses =
    'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50 sm:w-auto sm:justify-normal sm:gap-1.5 sm:px-3 sm:py-2';

  switch (variant) {
    case 'primary':
      return `${baseClasses} bg-blue-600 text-white hover:bg-blue-700 sm:bg-blue-600 sm:hover:bg-blue-700`;
    case 'success':
      return `${baseClasses} bg-green-600 text-white hover:bg-green-700 sm:bg-green-600 sm:hover:bg-green-700`;
    case 'secondary':
      return `${baseClasses} bg-slate-100 text-slate-700 hover:bg-slate-200 sm:bg-transparent sm:text-slate-500 sm:hover:bg-slate-100 sm:hover:text-slate-700`;
    case 'danger':
      return `${baseClasses} bg-red-50 text-red-600 hover:bg-red-100 sm:bg-transparent sm:text-slate-500 sm:hover:bg-red-50 sm:hover:text-red-600`;
  }
}

/**
 * Configurable action button component.
 * Renders a button based on resolved action configuration and executes the action on click.
 */
export function ConfigurableActionButton({
  button,
  onSuccess,
  onError,
  onResult,
}: ConfigurableActionButtonProps): React.JSX.Element {
  const [isExecuting, setIsExecuting] = useState(false);
  const { request } = useApiClient();

  const handleClick = async (): Promise<void> => {
    setIsExecuting(true);

    try {
      const baseUrl = button.endpoint.baseUrl ?? config.commandsAgentServiceUrl;

      const result = await executeAction(button.endpoint, button.action, request, baseUrl);

      // Call result callback if available (may include resource_url)
      if (result !== null) {
        onResult?.(result, button);
      }

      // Call success callback
      onSuccess?.();
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      onError?.(err);
    } finally {
      setIsExecuting(false);
    }
  };

  const Icon = getIcon(button.icon);

  return (
    <button
      onClick={() => {
        void handleClick();
      }}
      disabled={isExecuting}
      className={getButtonClasses(button.variant)}
    >
      {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {button.label}
    </button>
  );
}
