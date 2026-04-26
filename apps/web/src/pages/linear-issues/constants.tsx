import { CheckCircle2, ChevronDown, Circle, Clock, Eye } from 'lucide-react';

export const POLLING_INTERVAL_MS = 60_000; // 1 minute

export const PRIORITY_COLORS: Record<number, string> = {
  0: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
  1: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  2: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  3: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  4: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

export const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

export type TabType = 'todo' | 'backlog' | 'in_progress' | 'in_review' | 'to_test' | 'done' | 'archive';

export const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'todo', label: 'Todo', icon: <Circle className="h-4 w-4" /> },
  { id: 'backlog', label: 'Backlog', icon: <Circle className="h-4 w-4" /> },
  { id: 'in_progress', label: 'In Progress', icon: <Clock className="h-4 w-4" /> },
  { id: 'in_review', label: 'In Review', icon: <Eye className="h-4 w-4" /> },
  { id: 'to_test', label: 'To Test', icon: <CheckCircle2 className="h-4 w-4" /> },
  { id: 'done', label: 'Done', icon: <CheckCircle2 className="h-4 w-4" /> },
  { id: 'archive', label: 'Archive', icon: <ChevronDown className="h-4 w-4" /> },
];
