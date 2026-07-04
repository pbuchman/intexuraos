import {
  Bookmark,
  BookOpenText,
  Calendar,
  Code2,
  LayoutList,
  MessageSquare,
  PenTool,
  Settings,
  Sparkles,
  StickyNote,
  TrendingUp,
} from 'lucide-react';
import { CollapseToggle } from './sidebar/CollapseToggle.js';
import { CollapsibleNavSection } from './sidebar/CollapsibleNavSection.js';
import { MobileCloseButton, MobileOpenButton, MobileOverlay } from './sidebar/MobileToggle.js';
import { NotificationsSection } from './sidebar/NotificationsSection.js';
import { TopLevelNavLink } from './sidebar/TopLevelNavLink.js';
import {
  codeTasksItems,
  fishingAssistantItems,
  hellscriptItems,
  intexAgentItems,
  linearItems,
  llmUsageItems,
  researchAgentItems,
  settingsItems,
  whatsappItems,
} from './sidebar/navItems.js';
import { useSidebarState } from './sidebar/useSidebarState.js';

export function Sidebar(): React.JSX.Element {
  const s = useSidebarState();
  const isVisuallyCollapsed = s.isCollapsed && !s.isMobileOpen;
  const expandCollapsedSidebar = (): void => {
    localStorage.setItem('sidebar-collapsed', 'false');
    s.setIsCollapsed(false);
  };

  return (
    <>
      <MobileOpenButton onOpen={(): void => { s.setIsMobileOpen(true); }} />
      {s.isMobileOpen ? <MobileOverlay onClose={(): void => { s.setIsMobileOpen(false); }} /> : null}

      <aside
        className={`fixed bottom-0 left-0 top-16 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-300 dark:border-slate-700 dark:bg-slate-800 ${isVisuallyCollapsed ? 'w-16' : 'w-64'} ${s.isMobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
      >
        <MobileCloseButton onClose={(): void => { s.setIsMobileOpen(false); }} />

        <nav ref={s.navRef} className="mt-8 flex-1 space-y-1 overflow-y-auto p-3 md:mt-0">
          <CollapsibleNavSection label="Intex Agent" icon={Sparkles} items={intexAgentItems} rootPath="/intex-agent" isOpen={s.isIntexAgentOpen} onToggle={s.setIsIntexAgentOpen} onCollapsedOpen={expandCollapsedSidebar} isCollapsed={isVisuallyCollapsed} />
          <CollapsibleNavSection label="Code Tasks" icon={Code2} items={codeTasksItems} rootPath="/code-tasks" isOpen={s.isCodeTasksOpen} onToggle={s.setIsCodeTasksOpen} onCollapsedOpen={expandCollapsedSidebar} isCollapsed={isVisuallyCollapsed} />
          <CollapsibleNavSection label="Fishing Assistant" icon={BookOpenText} items={fishingAssistantItems} isOpen={s.isFishingAssistantOpen} onToggle={s.setIsFishingAssistantOpen} onCollapsedOpen={expandCollapsedSidebar} isCollapsed={isVisuallyCollapsed} />
          <CollapsibleNavSection label="Hellscript" icon={PenTool} items={hellscriptItems} rootPath="/hellscript" isOpen={s.isHellscriptOpen} onToggle={s.setIsHellscriptOpen} onCollapsedOpen={expandCollapsedSidebar} isCollapsed={isVisuallyCollapsed} />
          <CollapsibleNavSection label="LLM Usage" icon={TrendingUp} items={llmUsageItems} rootPath="/llm-usage" isOpen={s.isLlmUsageOpen} onToggle={s.setIsLlmUsageOpen} onCollapsedOpen={expandCollapsedSidebar} isCollapsed={isVisuallyCollapsed} />
          <CollapsibleNavSection label="Research Studio" icon={Sparkles} items={researchAgentItems} rootPath="/research" isOpen={s.isResearchAgentOpen} onToggle={s.setIsResearchAgentOpen} onCollapsedOpen={expandCollapsedSidebar} isCollapsed={isVisuallyCollapsed} />
          <CollapsibleNavSection label="Linear" icon={LayoutList} items={linearItems} rootPath="/linear" isOpen={s.isLinearOpen} onToggle={s.setIsLinearOpen} onCollapsedOpen={expandCollapsedSidebar} isCollapsed={isVisuallyCollapsed} />
          <TopLevelNavLink to="/calendar" label="Calendar" icon={Calendar} isCollapsed={isVisuallyCollapsed} />
          <TopLevelNavLink to="/my-bookmarks" label="Bookmarks" icon={Bookmark} isCollapsed={isVisuallyCollapsed} />
          <CollapsibleNavSection label="WhatsApp" icon={MessageSquare} items={whatsappItems} rootPath="/whatsapp" isOpen={s.isWhatsAppOpen} onToggle={s.setIsWhatsAppOpen} onCollapsedOpen={expandCollapsedSidebar} isCollapsed={isVisuallyCollapsed} />
          <NotificationsSection isOpen={s.isNotificationsOpen} onToggle={s.setIsNotificationsOpen} onCollapsedOpen={expandCollapsedSidebar} isCollapsed={isVisuallyCollapsed} savedFilters={s.savedFilters} />
          <TopLevelNavLink to="/my-notes" label="Notes" icon={StickyNote} isCollapsed={isVisuallyCollapsed} />
          <CollapsibleNavSection label="Settings" icon={Settings} items={settingsItems} isOpen={s.isSettingsOpen} onToggle={s.setIsSettingsOpen} onCollapsedOpen={expandCollapsedSidebar} isCollapsed={isVisuallyCollapsed} exactMatchAllItems />
        </nav>

        <CollapseToggle
          isCollapsed={s.isCollapsed}
          onToggle={(): void => {
            const next = !s.isCollapsed;
            localStorage.setItem('sidebar-collapsed', String(next));
            s.setIsCollapsed(next);
          }}
        />
      </aside>
    </>
  );
}
