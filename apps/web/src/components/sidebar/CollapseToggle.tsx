import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CollapseToggleProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function CollapseToggle({
  isCollapsed,
  onToggle,
}: CollapseToggleProps): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      className="hidden items-center justify-center border-t border-slate-200 p-3 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200 md:flex"
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
    </button>
  );
}
