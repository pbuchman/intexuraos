import { CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Card } from './ui/Card.js';

type StatusType = 'connected' | 'disconnected' | 'error' | 'loading';

interface StatusWidgetProps {
  title: string;
  status: StatusType;
  description: string;
  details?: string;
}

const statusConfig: Record<
  StatusType,
  {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    variant: 'default' | 'success' | 'warning' | 'error';
  }
> = {
  connected: { icon: CheckCircle, label: 'Connected', variant: 'success' },
  disconnected: { icon: XCircle, label: 'Not Connected', variant: 'warning' },
  error: { icon: AlertCircle, label: 'Error', variant: 'error' },
  loading: { icon: Loader2, label: 'Loading...', variant: 'default' },
};

export function StatusWidget({
  title,
  status,
  description,
  details,
}: StatusWidgetProps): React.JSX.Element {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Card variant={config.variant}>
      <div className="flex items-start gap-4">
        <div className={`shrink-0 ${status === 'loading' ? 'animate-spin' : ''}`}>
          <Icon
            className={`h-8 w-8 ${
              status === 'connected'
                ? 'text-green-600'
                : status === 'disconnected'
                  ? 'text-amber-600'
                  : status === 'error'
                    ? 'text-red-600'
                    : 'text-slate-400'
            }`}
          />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <p
            className={`text-sm font-medium ${
              status === 'connected'
                ? 'text-green-700'
                : status === 'disconnected'
                  ? 'text-amber-700'
                  : status === 'error'
                    ? 'text-red-700'
                    : 'text-slate-500'
            }`}
          >
            {config.label}
          </p>
          {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
          {details !== undefined && details !== '' ? (
            <p className="mt-1 text-xs text-slate-500">{details}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
