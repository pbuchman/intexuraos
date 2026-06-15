import { ListTodo, MessageSquare } from 'lucide-react';
import type { TabId } from './types.js';

interface InboxTabsProps {
  activeTab: TabId;
  actionsCount: number;
  commandsCount: number;
  onChange: (tab: TabId) => void;
}

export function InboxTabs({ activeTab, actionsCount, commandsCount, onChange }: InboxTabsProps): React.JSX.Element {
  return (
    <div className="mb-4 flex border-b border-slate-200 dark:border-slate-700">
      <button
        onClick={(): void => {
          onChange('actions');
        }}
        className={`flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
          activeTab === 'actions'
            ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
            : 'border-transparent text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300'
        }`}
      >
        <ListTodo className="h-4 w-4" />
        Actions ({String(actionsCount)})
      </button>
      <button
        onClick={(): void => {
          onChange('commands');
        }}
        className={`flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
          activeTab === 'commands'
            ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
            : 'border-transparent text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300'
        }`}
      >
        <MessageSquare className="h-4 w-4" />
        Commands ({String(commandsCount)})
      </button>
    </div>
  );
}
