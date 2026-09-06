import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BellRing, ChevronDown, ChevronUp, Filter } from 'lucide-react';
import type { SavedNotificationFilter } from '@/types';
import { buildFilterUrl, filterMatchesUrl } from './navItems.js';

interface NotificationsSectionProps {
  isOpen: boolean;
  onToggle: (next: boolean) => void;
  onCollapsedOpen?: () => void;
  isCollapsed: boolean;
  savedFilters: SavedNotificationFilter[];
}

export function NotificationsSection({
  isOpen,
  onToggle,
  onCollapsedOpen,
  isCollapsed,
  savedFilters,
}: NotificationsSectionProps): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="pt-2">
      <button
        aria-label="Mobile"
        onClick={(): void => {
          if (isCollapsed) {
            onToggle(true);
            onCollapsedOpen?.();
            return;
          }
          onToggle(!isOpen);
        }}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
      >
        <BellRing className="h-5 w-5 shrink-0" />
        {!isCollapsed ? (
          <>
            <span className="flex-1 text-left">Mobile</span>
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </>
        ) : null}
      </button>

      {isOpen && !isCollapsed ? (
        <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-600">
          <NavLink
            to="/notifications"
            className={(): string => {
              const isAllActive =
                location.pathname === '/notifications' && location.search === '';
              return `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isAllActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
              }`;
            }}
          >
            <Bell className="h-4 w-4 shrink-0" />
            <span>All</span>
          </NavLink>
          {savedFilters.map((filter) => {
            const isFilterActive =
              location.pathname === '/notifications' &&
              filterMatchesUrl(filter, location.search);
            return (
              <button
                key={filter.id}
                onClick={(): void => {
                  void navigate(buildFilterUrl(filter));
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isFilterActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <Filter className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="truncate text-left" title={filter.name}>
                  {filter.name}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
