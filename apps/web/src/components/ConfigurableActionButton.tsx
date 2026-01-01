/**
 * Configurable action button component.
 * Renders action buttons based on configuration.
 */

import { useState } from 'react';
import {
  Trash2,
  XCircle,
  Sparkles,
  Play,
  FileText,
  ListTodo,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import type { ResolvedActionButton } from '../types/actionConfig';
import { executeAction } from '../services/actionExecutor';
import { useApiClient } from '../hooks/useApiClient';

interface ConfigurableActionButtonProps {
  button: ResolvedActionButton;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

// Icon mapping for dynamic icon rendering
const ICON_MAP: Record<string, LucideIcon> = {
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
function getButtonClasses(variant: 'primary' | 'secondary' | 'danger'): string {
  const baseClasses =
    'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50';

  switch (variant) {
    case 'primary':
      return `${baseClasses} bg-blue-600 text-white hover:bg-blue-700`;
    case 'secondary':
      return `${baseClasses} text-slate-500 hover:bg-slate-100 hover:text-slate-700`;
    case 'danger':
      return `${baseClasses} text-slate-500 hover:bg-red-50 hover:text-red-600`;
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
}: ConfigurableActionButtonProps): React.JSX.Element {
  const [isExecuting, setIsExecuting] = useState(false);
  const { request } = useApiClient();

  const handleClick = async (): Promise<void> => {
    setIsExecuting(true);

    try {
      // Get base URL from environment
      const baseUrl = import.meta.env['INTEXURAOS_COMMANDS_ROUTER_SERVICE_URL'] as string;

      // Execute action
      await executeAction(button.endpoint, button.action, request, baseUrl);

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
