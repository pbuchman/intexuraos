import { RefreshCw } from 'lucide-react';
import { Button } from '@/components';

interface InboxHeaderProps {
  subtitle: string;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export function InboxHeader({ subtitle, isRefreshing, onRefresh }: InboxHeaderProps): React.JSX.Element {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Inbox</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>
    </div>
  );
}
