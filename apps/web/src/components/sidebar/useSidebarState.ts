import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/context';
import { getNotificationFilters } from '@/services/mobileNotificationsApi';
import type { SavedNotificationFilter } from '@/types';

export interface SidebarState {
  isCollapsed: boolean;
  setIsCollapsed: (next: boolean) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (next: boolean) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (next: boolean) => void;
  isNotificationsOpen: boolean;
  setIsNotificationsOpen: (next: boolean) => void;
  isResearchAgentOpen: boolean;
  setIsResearchAgentOpen: (next: boolean) => void;
  isHellscriptOpen: boolean;
  setIsHellscriptOpen: (next: boolean) => void;
  isCodeTasksOpen: boolean;
  setIsCodeTasksOpen: (next: boolean) => void;
  isLinearOpen: boolean;
  setIsLinearOpen: (next: boolean) => void;
  isLlmUsageOpen: boolean;
  setIsLlmUsageOpen: (next: boolean) => void;
  isFishingAssistantOpen: boolean;
  setIsFishingAssistantOpen: (next: boolean) => void;
  isWhatsAppOpen: boolean;
  setIsWhatsAppOpen: (next: boolean) => void;
  isIntexAgentOpen: boolean;
  setIsIntexAgentOpen: (next: boolean) => void;
  savedFilters: SavedNotificationFilter[];
  navRef: React.RefObject<HTMLElement | null>;
}

export function useSidebarState(): SidebarState {
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
  const [isHellscriptOpen, setIsHellscriptOpen] = useState(() =>
    window.location.hash.includes('/hellscript')
  );
  const [isCodeTasksOpen, setIsCodeTasksOpen] = useState(() =>
    window.location.hash.includes('/code-tasks')
  );
  const [isLinearOpen, setIsLinearOpen] = useState(() =>
    window.location.hash.includes('/linear')
  );
  const [isLlmUsageOpen, setIsLlmUsageOpen] = useState(() =>
    window.location.hash.includes('/llm-usage')
  );
  const [isFishingAssistantOpen, setIsFishingAssistantOpen] = useState(() =>
    window.location.hash.includes('/fishing-assistant')
  );
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(() =>
    window.location.hash.includes('/whatsapp') || window.location.hash.includes('/notes')
  );
  const [isIntexAgentOpen, setIsIntexAgentOpen] = useState(() =>
    window.location.hash.includes('/intex-agent')
  );
  const [savedFilters, setSavedFilters] = useState<SavedNotificationFilter[]>([]);
  const location = useLocation();
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

  // Auto-expand sections when on relevant pages
  useEffect(() => {
    if (location.pathname.startsWith('/settings')) {
      setIsSettingsOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/notifications')) {
      setIsNotificationsOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/research')) {
      setIsResearchAgentOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/hellscript')) {
      setIsHellscriptOpen(true);
    }
  }, [location.pathname]);

  // Auto-expand code tasks when on Battlefield or code-tasks sub-pages.
  useEffect(() => {
    if (location.pathname.startsWith('/code-tasks')) {
      setIsCodeTasksOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/linear')) {
      setIsLinearOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/llm-usage')) {
      setIsLlmUsageOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/fishing-assistant')) {
      setIsFishingAssistantOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/whatsapp') || location.pathname === '/notes') {
      setIsWhatsAppOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith('/intex-agent')) {
      setIsIntexAgentOpen(true);
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

  return {
    isCollapsed,
    setIsCollapsed,
    isMobileOpen,
    setIsMobileOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    isNotificationsOpen,
    setIsNotificationsOpen,
    isResearchAgentOpen,
    setIsResearchAgentOpen,
    isHellscriptOpen,
    setIsHellscriptOpen,
    isCodeTasksOpen,
    setIsCodeTasksOpen,
    isLinearOpen,
    setIsLinearOpen,
    isLlmUsageOpen,
    setIsLlmUsageOpen,
    isFishingAssistantOpen,
    setIsFishingAssistantOpen,
    isWhatsAppOpen,
    setIsWhatsAppOpen,
    isIntexAgentOpen,
    setIsIntexAgentOpen,
    savedFilters,
    navRef,
  };
}
