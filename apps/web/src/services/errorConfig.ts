import { AlertCircle, Settings, Wrench, Timer, Activity, XCircle, Ban } from 'lucide-react';
import type { ApiError } from './apiClient.js';

export type ErrorSeverity = 'info' | 'warning' | 'error';

export interface ErrorConfig {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  bgColor: string;
  borderColor: string;
  title: string;
  getMessage: (error: ApiError) => string;
  severity: ErrorSeverity;
  showDetails: boolean;
  primaryAction?: ErrorAction;
  secondaryAction?: ErrorAction;
}

export interface ErrorAction {
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  getAction: (error: ApiError, helpers: ActionHelpers) => () => void;
}

export interface ActionHelpers {
  onClose: () => void;
  onRetry: () => void;
  navigate: (path: string) => void;
}

// Error action types for declarative configuration
type BuiltAction = 'navigate' | 'retry' | 'close';

// Configuration for each error code
const ERROR_CONFIGS: Record<
  string,
  Omit<ErrorConfig, 'getMessage' | 'primaryAction' | 'secondaryAction'> & {
    message: string;
    primaryAction?: Omit<ErrorAction, 'getAction'> & { action: BuiltAction; navigateTo?: string };
    secondaryAction?: Omit<ErrorAction, 'getAction'> & { action: BuiltAction; navigateTo?: string };
  }
> = {
  WORKER_NOT_CONFIGURED: {
    icon: Settings,
    iconColor: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/30',
    borderColor: 'border-amber-200 dark:border-amber-800',
    title: 'Workers not configured',
    message: 'Please configure at least one worker before submitting code tasks.',
    severity: 'warning',
    showDetails: false,
    primaryAction: { label: 'Configure workers', variant: 'primary', action: 'navigate', navigateTo: '/settings/workers' },
    secondaryAction: { label: 'Cancel', variant: 'secondary', action: 'close' },
  },
  INVALID_WORKER: {
    icon: Ban,
    iconColor: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/30',
    borderColor: 'border-red-200 dark:border-red-800',
    title: 'Invalid worker',
    message: 'The selected worker is not configured or enabled.',
    severity: 'error',
    showDetails: true,
    primaryAction: { label: 'Try again', variant: 'secondary', action: 'retry' },
    secondaryAction: { label: 'View workers', variant: 'secondary', action: 'navigate', navigateTo: '/settings/workers' },
  },
  WORKER_UNHEALTHY: {
    icon: Activity,
    iconColor: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/30',
    borderColor: 'border-red-200 dark:border-red-800',
    title: 'Worker unhealthy',
    message: 'The selected worker is currently unavailable.',
    severity: 'error',
    showDetails: true,
    primaryAction: { label: 'Try again', variant: 'secondary', action: 'retry' },
    secondaryAction: { label: 'View workers', variant: 'secondary', action: 'navigate', navigateTo: '/settings/workers' },
  },
  MISCONFIGURED: {
    icon: Wrench,
    iconColor: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/30',
    borderColor: 'border-amber-200 dark:border-amber-800',
    title: 'Service unavailable',
    message: 'The code agent service is temporarily unavailable.',
    severity: 'warning',
    showDetails: true,
    primaryAction: { label: 'Try again', variant: 'primary', action: 'retry' },
    secondaryAction: { label: 'Cancel', variant: 'secondary', action: 'close' },
  },
  RATE_LIMITED: {
    icon: Timer,
    iconColor: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/30',
    borderColor: 'border-amber-200 dark:border-amber-800',
    title: 'Rate limited',
    message: 'You have exceeded the rate limit. Please wait before submitting more tasks.',
    severity: 'warning',
    showDetails: true,
    primaryAction: { label: 'Try again', variant: 'primary', action: 'retry' },
    secondaryAction: { label: 'Cancel', variant: 'secondary', action: 'close' },
  },
  TIMEOUT: {
    icon: Timer,
    iconColor: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/30',
    borderColor: 'border-amber-200 dark:border-amber-800',
    title: 'Request timed out',
    message: 'The request took too long to complete. Please check your connection and try again.',
    severity: 'warning',
    showDetails: false,
    primaryAction: { label: 'Try again', variant: 'primary', action: 'retry' },
    secondaryAction: { label: 'Cancel', variant: 'secondary', action: 'close' },
  },
  INTERNAL_ERROR: {
    icon: AlertCircle,
    iconColor: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/30',
    borderColor: 'border-red-200 dark:border-red-800',
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again.',
    severity: 'error',
    showDetails: true,
    primaryAction: { label: 'Try again', variant: 'primary', action: 'retry' },
    secondaryAction: { label: 'Cancel', variant: 'secondary', action: 'close' },
  },
  INVALID_REQUEST: {
    icon: XCircle,
    iconColor: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/30',
    borderColor: 'border-red-200 dark:border-red-800',
    title: 'Invalid Request',
    message: 'The request contains invalid data.',
    severity: 'error',
    showDetails: true,
    primaryAction: { label: 'Try again', variant: 'primary', action: 'retry' },
    secondaryAction: { label: 'Cancel', variant: 'secondary', action: 'close' },
  },
  UNKNOWN: {
    icon: AlertCircle,
    iconColor: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/30',
    borderColor: 'border-red-200 dark:border-red-800',
    title: 'Error',
    message: 'An unknown error occurred.',
    severity: 'error',
    showDetails: true,
    primaryAction: { label: 'Try again', variant: 'primary', action: 'retry' },
    secondaryAction: { label: 'Cancel', variant: 'secondary', action: 'close' },
  },
};

function buildAction(
  actionDef: Omit<ErrorAction, 'getAction'> & { action: BuiltAction; navigateTo?: string }
): ErrorAction {
  return {
    label: actionDef.label,
    variant: actionDef.variant,
    getAction: () =>
      () => {
        if (actionDef.action === 'navigate' && actionDef.navigateTo !== undefined) {
          window.location.href = actionDef.navigateTo;
        } else if (actionDef.action === 'retry') {
          // Retry is handled by the caller
          return;
        } else if (actionDef.action === 'close') {
          // Close is handled by the caller
          return;
        }
      },
  };
}

export function getErrorConfig(error: ApiError, _helpers: ActionHelpers): ErrorConfig {
  const config = ERROR_CONFIGS[error.code] ?? ERROR_CONFIGS['UNKNOWN'];
  if (config === undefined) {
    // Should never happen since UNKNOWN is always defined
    throw new Error('No error config found');
  }

  const result: ErrorConfig = {
    icon: config.icon,
    iconColor: config.iconColor,
    bgColor: config.bgColor,
    borderColor: config.borderColor,
    title: config.title,
    severity: config.severity,
    showDetails: config.showDetails,
    getMessage: () => config.message,
  };

  if (config.primaryAction !== undefined) {
    result.primaryAction = buildAction(config.primaryAction);
  }
  if (config.secondaryAction !== undefined) {
    result.secondaryAction = buildAction(config.secondaryAction);
  }

  return result;
}
