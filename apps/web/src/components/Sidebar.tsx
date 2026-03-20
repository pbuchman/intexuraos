import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart2,
  Bell,
  BellRing,
  Bookmark,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Code2,
  Database,
  DollarSign,
  FileText,
  Filter,
  GitBranch,
  RadioTower,
  Inbox,
  Key,
  LayoutList,
  List,
  Menu,
  MessageCircle,
  MessageSquare,
  PenTool,
  Plus,
  Server,
  Settings,
  Sparkles,
  StickyNote,
  Timer,
  TrendingUp,
  X,
} from 'lucide-react';
import { useAuth } from '@/context';
import { getNotificationFilters } from '@/services/mobileNotificationsApi';
import type { SavedNotificationFilter } from '@/types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const settingsItems: NavItem[] = [
  { to: '/settings/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { to: '/settings/mobile', label: 'Mobile', icon: Bell },
  { to: '/settings/notion', label: 'Notion', icon: FileText },
  { to: '/settings/calendar', label: 'Google Calendar', icon: Calendar },
  { to: '/settings/linear', label: 'Linear', icon: LayoutList },
  { to: '/settings/github', label: 'GitHub', icon: GitBranch },
  { to: '/settings/code', label: 'Code Settings', icon: Server },
  { to: '/settings/api-keys', label: 'API Keys', icon: Key },
  { to: '/settings/llm-pricing', label: 'LLM Pricing', icon: DollarSign },
  { to: '/settings/usage-costs', label: 'Usage Costs', icon: TrendingUp },
];

const researchAgentItems: NavItem[] = [
  { to: '/research', label: 'Library', icon: List },
  { to: '/research/new', label: 'New Study', icon: Plus },
];

const dataInsightsItems: NavItem[] = [
  { to: '/data-insights', label: 'Data Sources', icon: List },
  { to: '/data-insights/new', label: 'Add Source', icon: Plus },
  { to: '/data-insights/visualizations', label: 'Visualizations', icon: BarChart2 },
];

const hellscriptItems: NavItem[] = [
  { to: '/hellscript', label: 'Thoughts', icon: List },
  { to: '/hellscript/new', label: 'New Conversation', icon: Plus },
];

const codeTasksItems: NavItem[] = [
  { to: '/code-tasks', label: 'Battlefield', icon: List },
  { to: '/code-tasks/new', label: 'New Task', icon: Plus },
  { to: '/code-tasks/dispatch-queue', label: 'Dispatch Queue', icon: Clock },
  { to: '/code-tasks/pr-events', label: 'GitHub Event Log', icon: RadioTower },
];

const cronAgentItems: NavItem[] = [
  { to: '/cron-agent', label: 'Schedules', icon: List },
  { to: '/cron-agent/executions', label: 'Executions', icon: Activity },
];

/**
 * Build URL search params from a saved notification filter.
 * Arrays are joined with commas for URL encoding.
 * Includes filterId to track which filter was explicitly selected.
 */
function buildFilterUrl(filter: SavedNotificationFilter): string {
  const params = new URLSearchParams();
  params.set('filterId', filter.id);
  if (filter.app !== undefined && filter.app.length > 0) {
    params.set('app', filter.app.join(','));
  }
  if (filter.source !== undefined && filter.source !== '') {
    params.set('source', filter.source);
  }
  if (filter.title !== undefined && filter.title !== '') {
    params.set('title', filter.title);
  }
  return `/notifications?${params.toString()}`;
}

/**
 * Check if a saved filter matches current URL.
 * Prioritizes filterId param for explicit selection, falls back to criteria match.
 */
function filterMatchesUrl(filter: SavedNotificationFilter, search: string): boolean {
  const params = new URLSearchParams(search);
  const urlFilterId = params.get('filterId');

  // If filterId is in URL, only match by ID (explicit selection)
  if (urlFilterId !== null) {
    return filter.id === urlFilterId;
  }

  // Fallback: match by criteria (for manually-entered filter params)
  const urlApp = params.get('app') ?? '';
  const urlSource = params.get('source') ?? '';
  const urlTitle = params.get('title') ?? '';

  const filterApp = filter.app !== undefined && filter.app.length > 0 ? filter.app.join(',') : '';
  const filterSource = filter.source ?? '';
  const filterTitle = filter.title ?? '';

  return filterApp === urlApp && filterSource === urlSource && filterTitle === urlTitle;
}

export function Sidebar(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem('sidebar-collapsed') === 'true'
  );
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isResearchAgentOpen, setIsResearchAgentOpen] = useState(() =>
    window.location.hash.includes('/research')
  );
  const [isDataInsightsOpen, setIsDataInsightsOpen] = useState(() =>
    window.location.hash.includes('/data-insights')
  );
  const [isHellscriptOpen, setIsHellscriptOpen] = useState(() =>
    window.location.hash.includes('/hellscript')
  );
  const [isCodeTasksOpen, setIsCodeTasksOpen] = useState(() =>
    window.location.hash.includes('/code-tasks')
  );
  const [isCronAgentOpen, setIsCronAgentOpen] = useState(() =>
    window.location.hash.includes('/cron-agent')
  );
  const [savedFilters, setSavedFilters] = useState<SavedNotificationFilter[]>([]);
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement>(null);
  const scrollPositionRef = useRef(0);

  // Preserve scroll position across route changes
  useEffect(() => {
    const nav = navRef.current;
    if (nav === null) return;

    const handleScroll = (): void => {
      scrollPositionRef.current = nav.scrollTop;
    };

    nav.addEventListener('scroll', handleScroll);
    return (): void => {
      nav.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Restore scroll position after route change
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (nav !== null && scrollPositionRef.current > 0) {
      nav.scrollTop = scrollPositionRef.current;
    }
  }, [location.pathname]);

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

  // Auto-expand researchAgent when on research page
  useEffect(() => {
    if (location.pathname.startsWith('/research')) {
      setIsResearchAgentOpen(true);
    }
  }, [location.pathname]);

  // Auto-expand data insights when on data-insights page
  useEffect(() => {
    if (location.pathname.startsWith('/data-insights')) {
      setIsDataInsightsOpen(true);
    }
  }, [location.pathname]);

  // Auto-expand hellscript when on hellscript page
  useEffect(() => {
    if (location.pathname.startsWith('/hellscript')) {
      setIsHellscriptOpen(true);
    }
  }, [location.pathname]);

  // Auto-expand code tasks when on code-tasks page
  useEffect(() => {
    if (location.pathname.startsWith('/code-tasks')) {
      setIsCodeTasksOpen(true);
    }
  }, [location.pathname]);

  // Auto-expand cron agent when on cron-agent page
  useEffect(() => {
    if (location.pathname.startsWith('/cron-agent')) {
      setIsCronAgentOpen(true);
    }
  }, [location.pathname]);

  // Fetch saved filters from mobile-notifications-service
  const fetchFilters = useCallback(async (): Promise<void> => {
    try {
      const token = await getAccessToken();
      const data = await getNotificationFilters(token);
      setSavedFilters(data.savedFilters);
    } catch {
      /* Best-effort fetch, ignore errors */
    }
  }, [getAccessToken]);

  useEffect(() => {
    void fetchFilters();
  }, [fetchFilters]);

  // Listen for custom event to refresh filters (dispatched by MobileNotificationsListPage)
  useEffect(() => {
    const handleRefresh = (): void => {
      void fetchFilters();
    };
    window.addEventListener('notification-filters-changed', handleRefresh);
    return (): void => {
      window.removeEventListener('notification-filters-changed', handleRefresh);
    };
  }, [fetchFilters]);

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
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-600 shadow-md transition-colors hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 md:hidden"
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
        className={`fixed bottom-0 left-0 top-16 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-300 dark:border-slate-700 dark:bg-slate-800
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
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 md:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>

        <nav ref={navRef} className="mt-8 flex-1 space-y-1 overflow-y-auto p-3 md:mt-0">
          {/* Inbox - primary nav item */}
          <NavLink
            to="/inbox"
            end
            className={({ isActive }): string =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`
            }
          >
            <Inbox className="h-5 w-5 shrink-0" />
            {!isCollapsed ? <span>Inbox</span> : null}
          </NavLink>

          {/* Hellscript section (collapsible) */}
          <div className="pt-2">
            <button
              onClick={(): void => {
                if (!isHellscriptOpen) {
                  void navigate(hellscriptItems[0]?.to ?? '/hellscript');
                }
                setIsHellscriptOpen(!isHellscriptOpen);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname.startsWith('/hellscript')
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`}
            >
              <PenTool className="h-5 w-5 shrink-0" />
              {!isCollapsed ? (
                <>
                  <span className="flex-1 text-left">Hellscript</span>
                  {isHellscriptOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </>
              ) : null}
            </button>

            {/* Hellscript sub-items */}
            {isHellscriptOpen && !isCollapsed ? (
              <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-600">
                {hellscriptItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/hellscript'}
                    className={({ isActive }): string =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
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

          {/* Code Tasks section (collapsible) */}
          <div className="pt-2">
            <button
              onClick={(): void => {
                if (!isCodeTasksOpen) {
                  void navigate(codeTasksItems[0]?.to ?? '/code-tasks');
                }
                setIsCodeTasksOpen(!isCodeTasksOpen);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname.startsWith('/code-tasks')
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`}
            >
              <Code2 className="h-5 w-5 shrink-0" />
              {!isCollapsed ? (
                <>
                  <span className="flex-1 text-left">Code Tasks</span>
                  {isCodeTasksOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </>
              ) : null}
            </button>

            {/* Code Tasks sub-items */}
            {isCodeTasksOpen && !isCollapsed ? (
              <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-600">
                {codeTasksItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/code-tasks'}
                    className={({ isActive }): string =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
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

          {/* Cron Agent section (collapsible) */}
          <div className="pt-2">
            <button
              onClick={(): void => {
                if (!isCronAgentOpen) {
                  void navigate(cronAgentItems[0]?.to ?? '/cron-agent');
                }
                setIsCronAgentOpen(!isCronAgentOpen);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname.startsWith('/cron-agent')
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`}
            >
              <Timer className="h-5 w-5 shrink-0" />
              {!isCollapsed ? (
                <>
                  <span className="flex-1 text-left">Cron Agent</span>
                  {isCronAgentOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </>
              ) : null}
            </button>

            {/* Cron Agent sub-items */}
            {isCronAgentOpen && !isCollapsed ? (
              <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-600">
                {cronAgentItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/cron-agent'}
                    className={({ isActive }): string =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
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

          {/* Research Studio section (collapsible) */}
          <div className="pt-2">
            <button
              onClick={(): void => {
                if (!isResearchAgentOpen) {
                  void navigate(researchAgentItems[0]?.to ?? '/research');
                }
                setIsResearchAgentOpen(!isResearchAgentOpen);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname.startsWith('/research')
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`}
            >
              <Sparkles className="h-5 w-5 shrink-0" />
              {!isCollapsed ? (
                <>
                  <span className="flex-1 text-left">Research Studio</span>
                  {isResearchAgentOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </>
              ) : null}
            </button>

            {/* ResearchAgent sub-items */}
            {isResearchAgentOpen && !isCollapsed ? (
              <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-600">
                {researchAgentItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/research'}
                    className={({ isActive }): string =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
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
                if (!isDataInsightsOpen) {
                  void navigate(dataInsightsItems[0]?.to ?? '/data-insights');
                }
                setIsDataInsightsOpen(!isDataInsightsOpen);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname.startsWith('/data-insights')
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
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
              <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-600">
                {dataInsightsItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/data-insights'}
                    className={({ isActive }): string =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
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

          {/* Linear Issues */}
          <NavLink
            to="/linear"
            end
            className={({ isActive }): string =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`
            }
          >
            <LayoutList className="h-5 w-5 shrink-0" />
            {!isCollapsed ? <span>Linear Issues</span> : null}
          </NavLink>

          {/* Calendar */}
          <NavLink
            to="/calendar"
            end
            className={({ isActive }): string =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`
            }
          >
            <Calendar className="h-5 w-5 shrink-0" />
            {!isCollapsed ? <span>Calendar</span> : null}
          </NavLink>

          {/* Bookmarks */}
          <NavLink
            to="/my-bookmarks"
            end
            className={({ isActive }): string =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`
            }
          >
            <Bookmark className="h-5 w-5 shrink-0" />
            {!isCollapsed ? <span>Bookmarks</span> : null}
          </NavLink>

          {/* WhatsApp */}
          <NavLink
            to="/notes"
            end
            className={({ isActive }): string =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`
            }
          >
            <MessageSquare className="h-5 w-5 shrink-0" />
            {!isCollapsed ? <span>WhatsApp</span> : null}
          </NavLink>

          {/* Mobile (notifications with saved filters) */}
          <div className="pt-2">
            <button
              onClick={(): void => {
                if (!isNotificationsOpen) {
                  void navigate('/notifications');
                }
                setIsNotificationsOpen(!isNotificationsOpen);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname.startsWith('/notifications')
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`}
            >
              <BellRing className="h-5 w-5 shrink-0" />
              {!isCollapsed ? (
                <>
                  <span className="flex-1 text-left">Mobile</span>
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

          {/* Notes */}
          <NavLink
            to="/my-notes"
            end
            className={({ isActive }): string =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`
            }
          >
            <StickyNote className="h-5 w-5 shrink-0" />
            {!isCollapsed ? <span>Notes</span> : null}
          </NavLink>

          {/* Checklists */}
          <NavLink
            to="/my-todos"
            end
            className={({ isActive }): string =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
              }`
            }
          >
            <CheckSquare className="h-5 w-5 shrink-0" />
            {!isCollapsed ? <span>Checklists</span> : null}
          </NavLink>

          {/* Settings section (collapsible) */}
          <div className="pt-2">
            <button
              onClick={(): void => {
                setIsSettingsOpen(!isSettingsOpen);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                location.pathname.startsWith('/settings')
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
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
              <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3 dark:border-slate-600">
                {settingsItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    className={({ isActive }): string =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
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
            const next = !isCollapsed;
            localStorage.setItem('sidebar-collapsed', String(next));
            setIsCollapsed(next);
          }}
          className="hidden items-center justify-center border-t border-slate-200 p-3 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200 md:flex"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </aside>
    </>
  );
}
