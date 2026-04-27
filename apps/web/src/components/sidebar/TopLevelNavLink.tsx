import { NavLink } from 'react-router-dom';

interface TopLevelNavLinkProps {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isCollapsed: boolean;
  end?: boolean;
}

export function TopLevelNavLink({
  to,
  label,
  icon: Icon,
  isCollapsed,
  end = true,
}: TopLevelNavLinkProps): React.JSX.Element {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }): string =>
        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
        }`
      }
    >
      <Icon className="h-5 w-5 shrink-0" />
      {!isCollapsed ? <span>{label}</span> : null}
    </NavLink>
  );
}
