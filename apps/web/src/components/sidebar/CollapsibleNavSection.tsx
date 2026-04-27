import { NavLink, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { NavItem } from './navItems.js';

interface CollapsibleNavSectionProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
  isOpen: boolean;
  onToggle: (next: boolean) => void;
  isCollapsed: boolean;
  isActive: boolean;
  /** Path used for `end` matching on each sub-item (the root path of the section). */
  rootPath?: string;
  /** When true, navigate to the first item on open. Defaults to true. */
  navigateOnOpen?: boolean;
  /** Optional fallback path to navigate to when items[0] is missing. */
  navigateFallback?: string;
  /** When true, every sub-item uses `end` exact-match. Defaults to false. */
  exactMatchAllItems?: boolean;
}

export function CollapsibleNavSection({
  label,
  icon: Icon,
  items,
  isOpen,
  onToggle,
  isCollapsed,
  isActive,
  rootPath,
  navigateOnOpen = true,
  navigateFallback,
  exactMatchAllItems = false,
}: CollapsibleNavSectionProps): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="pt-2">
      <button
        onClick={(): void => {
          if (!isOpen && navigateOnOpen) {
            void navigate(items[0]?.to ?? navigateFallback ?? '/');
          }
          onToggle(!isOpen);
        }}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
        }`}
      >
        <Icon className="h-5 w-5 shrink-0" />
        {!isCollapsed ? (
          <>
            <span className="flex-1 text-left">{label}</span>
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </>
        ) : null}
      </button>

      {isOpen && !isCollapsed ? (
        <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-600">
          {items.map((item) => {
            const endValue =
              exactMatchAllItems
                ? true
                : rootPath !== undefined
                  ? item.to === rootPath
                  : false;
            return (
            <NavLink
              key={item.to}
              to={item.to}
              end={endValue}
              className={({ isActive: subActive }): string =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  subActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
