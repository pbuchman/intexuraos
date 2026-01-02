import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Bell,
  BellRing,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Database,
  FileText,
  Filter,
  Inbox,
  Key,
  LayoutDashboard,
  List,
  Menu,
  MessageCircle,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { useAuth } from '@/context';
import { getUserSettings } from '@/services/authApi';
import type { NotificationFilter } from '@/types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const settingsItems: NavItem[] = [
  { to: '/settings/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { to: '/settings/mobile', label: 'Mobile', icon: Bell },
  { to: '/settings/notion', label: 'Notion', icon: FileText },
  { to: '/settings/api-keys', label: 'API Keys', icon: Key },
];

const orchestratorItems: NavItem[] = [
  { to: '/research', label: 'Library', icon: List },
  { to: '/research/new', label: 'New Study', icon: Plus },
];

const dataInsightsItems: NavItem[] = [
  { to: '/data-insights', label: 'Data Sources', icon: List },
  { to: '/data-insights/new', label: 'Add Source', icon: Plus },
];

/**
 * Build URL search params from a notification filter.
 */
function buildFilterUrl(filter: NotificationFilter): string {
  const params = new URLSearchParams();
  if (filter.app !== undefined) {
    params.set('app', filter.app);
  }
  if (filter.source !== undefined) {
    params.set('source', filter.source);
  }
  if (filter.title !== undefined) {
    params.set('title', filter.title);
  }
  const queryString = params.toString();
  return queryString !== '' ? `/notifications?${queryString}` : '/notifications';
}

/**
 * Check if a filter matches current URL search params.
 */
function filterMatchesUrl(filter: NotificationFilter, search: string): boolean {
  const params = new URLSearchParams(search);
  const urlApp = params.get('app') ?? '';
  const urlSource = params.get('source') ?? '';
  const urlTitle = params.get('title') ?? '';

  return (
    (filter.app ?? '') === urlApp &&
    (filter.source ?? '') === urlSource &&
    (filter.title ?? '') === urlTitle
  );
}

export function Sidebar(): React.JSX.Element {
  const { getAccessToken, user } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isOrchestratorOpen, setIsOrchestratorOpen] = useState(() =>
    window.location.hash.includes('/research')
  );
  const [isDataInsightsOpen, setIsDataInsightsOpen] = useState(() =>
    window.location.hash.includes('/data-insights')
  );
  const [savedFilters, setSavedFilters] = useState<NotificationFilter[]>([]);
  const location = useLocation();

  // Auto-expand settings when on a settings page
  useEffect(() => {
    if (location.pathname.startsWith('/settings')) {
      setIsSettingsOpen(true);
    }
  }, [location.pathname]);

  // Auto-expand notifications when on notifications page
  useEffect(() => {
    if (location.pathname.startsWith('/notifications')) {
      setIsNotificationsOpen(true);
    }
  }, [location.pathname]);

  // Auto-expand orchestrator when on research page
  useEffect(() => {
    if (location.pathname.startsWith('/research')) {
      setIsOrchestratorOpen(true);
    }
  }, [location.pathname]);

  // Auto-expand data insights when on data-insights page
  useEffect(() => {
    if (location.pathname.startsWith('/data-insights')) {
      setIsDataInsightsOpen(true);
    }
  }, [location.pathname]);

  // Fetch saved filters
  useEffect(() => {
    const fetchFilters = async (): Promise<void> => {
      if (user?.sub === undefined) return;
      try {
        const token = await getAccessToken();
        const settings = await getUserSettings(token, user.sub);
        setSavedFilters(settings.notifications.filters);
      } catch {
        /* Best-effort fetch, ignore errors */
      }
    };
    void fetchFilters();
  }, [getAccessToken, user?.sub]);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [location.pathname]);

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsMobileOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return (): void => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return (): void => {
      document.body.style.overflow = '';
    };
  }, [isMobileOpen]);

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={(): void => {
          setIsMobileOpen(true);
        }}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-600 shadow-md transition-colors hover:bg-slate-100 md:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {isMobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={(): void => {
            setIsMobileOpen(false);
          }}
          aria-hidden="true"
        />
      ) : null}

      {/* Sidebar */}
      <aside
        className={`fixed bottom-0 left-0 top-16 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-300
          ${isCollapsed ? 'w-16' : 'w-64'}
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
      >
        {/* Mobile close button */}
        <button
          onClick={(): void => {
            setIsMobileOpen(false);
          }}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 md:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>

        <nav className="mt-8 flex-1 space-y-1 overflow-y-auto p-3 md:mt-0">
          {/* Inbox - primary nav item */}
          <NavLink
            to="/inbox"
            end
            className={({ isActive }): string =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            <Inbox className="h-5 w-5 shrink-0" />
            {!isCollapsed ? <span>Inbox</span> : null}
          </NavLink>

          {/* LLM Orchestrator section (collapsible) */}
          <div className="pt-2">
            <button
              onClick={(): void => {
                setIsOrchestratorOpen(!isOrchestratorOpen);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname.startsWith('/research')
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Sparkles className="h-5 w-5 shrink-0" />
              {!isCollapsed ? (
                <>
                  <span className="flex-1 text-left">Research Studio</span>
                  {isOrchestratorOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </>
              ) : null}
            </button>

            {/* Orchestrator sub-items */}
            {isOrchestratorOpen && !isCollapsed ? (
              <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3">
                {orchestratorItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/research'}
                    className={({ isActive }): string =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ) : null}
          </div>

          {/* Data Insights section (collapsible) */}
          <div className="pt-2">
            <button
              onClick={(): void => {
                setIsDataInsightsOpen(!isDataInsightsOpen);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname.startsWith('/data-insights')
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Database className="h-5 w-5 shrink-0" />
              {!isCollapsed ? (
                <>
                  <span className="flex-1 text-left">Data Insights</span>
                  {isDataInsightsOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </>
              ) : null}
            </button>

            {/* Data Insights sub-items */}
            {isDataInsightsOpen && !isCollapsed ? (
              <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3">
                {dataInsightsItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/data-insights'}
                    className={({ isActive }): string =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ) : null}
          </div>

          {/* Notes */}
          <NavLink
            to="/notes"
            end
            className={({ isActive }): string =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            <MessageSquare className="h-5 w-5 shrink-0" />
            {!isCollapsed ? <span>Notes</span> : null}
          </NavLink>

          {/* Notifications section (collapsible with saved filters) */}
          <div className="pt-2">
            <button
              onClick={(): void => {
                setIsNotificationsOpen(!isNotificationsOpen);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <BellRing className="h-5 w-5 shrink-0" />
              {!isCollapsed ? (
                <>
                  <span className="flex-1 text-left">Notifications</span>
                  {isNotificationsOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </>
              ) : null}
            </button>

            {/* Notifications sub-items */}
            {isNotificationsOpen && !isCollapsed ? (
              <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3">
                <NavLink
                  to="/notifications"
                  end
                  className={({ isActive }): string =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                    }`
                  }
                >
                  <Bell className="h-4 w-4 shrink-0" />
                  <span>All</span>
                </NavLink>
                {savedFilters.map((filter) => (
                  <NavLink
                    key={filter.name}
                    to={buildFilterUrl(filter)}
                    className={(): string =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        filterMatchesUrl(filter, location.search)
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    <Filter className="h-4 w-4 shrink-0 text-blue-600" />
                    <span title={filter.name}>{filter.name}</span>
                  </NavLink>
                ))}
              </div>
            ) : null}
          </div>

          {/* System Health */}
          <div className="pt-2">
            <NavLink
              to="/system-health"
              className={({ isActive }): string =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <LayoutDashboard className="h-5 w-5 shrink-0" />
              {!isCollapsed ? <span>System Health</span> : null}
            </NavLink>
          </div>

          {/* Settings section (collapsible) */}
          <div className="pt-2">
            <button
              onClick={(): void => {
                setIsSettingsOpen(!isSettingsOpen);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname.startsWith('/settings')
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Settings className="h-5 w-5 shrink-0" />
              {!isCollapsed ? (
                <>
                  <span className="flex-1 text-left">Settings</span>
                  {isSettingsOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </>
              ) : null}
            </button>

            {/* Settings sub-items */}
            {isSettingsOpen && !isCollapsed ? (
              <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3">
                {settingsItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    className={({ isActive }): string =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ) : null}
          </div>
        </nav>

        {/* Collapse button - desktop only */}
        <button
          onClick={(): void => {
            setIsCollapsed(!isCollapsed);
          }}
          className="hidden items-center justify-center border-t border-slate-200 p-3 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 md:flex"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </aside>
    </>
  );
}
