import { Inbox, ListTodo } from 'lucide-react';
import { Card } from '@/components';

interface ActionsEmptyStateProps {
  hasFilters: boolean;
}

export function ActionsEmptyState({ hasFilters }: ActionsEmptyStateProps): React.JSX.Element {
  return (
    <Card title="">
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ListTodo className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
        <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300">
          {hasFilters ? 'No matching actions' : 'No actions yet'}
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {hasFilters
            ? 'Try adjusting your filters or clear them to see all actions.'
            : 'Actions are created when commands are classified.'}
        </p>
      </div>
    </Card>
  );
}

export function CommandsEmptyState(): React.JSX.Element {
  return (
    <Card title="">
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Inbox className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
        <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300">No commands yet</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Send a text or voice message via WhatsApp to create a command.
        </p>
      </div>
    </Card>
  );
}
