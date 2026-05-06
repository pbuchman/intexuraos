import { useLocation } from 'react-router-dom';
import {
  Bookmark,
  BookOpenText,
  Calendar,
  CheckSquare,
  Code2,
  Inbox,
  LayoutList,
  MessageSquare,
  Newspaper,
  PenTool,
  Settings,
  Sparkles,
  StickyNote,
  Swords,
  Timer,
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
  cronAgentItems,
  hellscriptItems,
  linearItems,
  llmUsageItems,
  researchAgentItems,
  settingsItems,
} from './sidebar/navItems.js';
import { useSidebarState } from './sidebar/useSidebarState.js';

export function Sidebar(): React.JSX.Element {
  const location = useLocation();
  const s = useSidebarState();

  return (
    <>
      <MobileOpenButton
        onOpen={(): void => {
          s.setIsMobileOpen(true);
        }}
      />

      {s.isMobileOpen ? (
        <MobileOverlay
          onClose={(): void => {
            s.setIsMobileOpen(false);
          }}
        />
      ) : null}

      <aside
        className={`fixed bottom-0 left-0 top-16 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-300 dark:border-slate-700 dark:bg-slate-800
          ${s.isCollapsed ? 'w-16' : 'w-64'}
          ${s.isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
      >
        <MobileCloseButton
          onClose={(): void => {
            s.setIsMobileOpen(false);
          }}
        />

        <nav ref={s.navRef} className="mt-8 flex-1 space-y-1 overflow-y-auto p-3 md:mt-0">
          <TopLevelNavLink to="/inbox" label="Inbox" icon={Inbox} isCollapsed={s.isCollapsed} />
          <TopLevelNavLink to="/code-tasks" label="Battlefield" icon={Swords} isCollapsed={s.isCollapsed} />
          <TopLevelNavLink to="/notifications/digests" label="Digests" icon={Newspaper} isCollapsed={s.isCollapsed} />

          <CollapsibleNavSection
            label="Fishing Assistant"
            icon={BookOpenText}
            items={fishingAssistantItems}
            isOpen={s.isFishingAssistantOpen}
            onToggle={s.setIsFishingAssistantOpen}
            isCollapsed={s.isCollapsed}
            isActive={location.pathname.startsWith('/fishing-assistant')}
            navigateFallback="/fishing-assistant/digests"
          />

          <CollapsibleNavSection
            label="Hellscript"
            icon={PenTool}
            items={hellscriptItems}
            rootPath="/hellscript"
            isOpen={s.isHellscriptOpen}
            onToggle={s.setIsHellscriptOpen}
            isCollapsed={s.isCollapsed}
            isActive={location.pathname.startsWith('/hellscript')}
            navigateFallback="/hellscript"
          />

          <CollapsibleNavSection
            label="Code Tasks"
            icon={Code2}
            items={codeTasksItems}
            isOpen={s.isCodeTasksOpen}
            onToggle={s.setIsCodeTasksOpen}
            isCollapsed={s.isCollapsed}
            isActive={
              location.pathname.startsWith('/code-tasks') && location.pathname !== '/code-tasks'
            }
            navigateFallback="/code-tasks/new"
          />

          <CollapsibleNavSection
            label="LLM Usage"
            icon={TrendingUp}
            items={llmUsageItems}
            rootPath="/llm-usage"
            isOpen={s.isLlmUsageOpen}
            onToggle={s.setIsLlmUsageOpen}
            isCollapsed={s.isCollapsed}
            isActive={location.pathname.startsWith('/llm-usage')}
            navigateFallback="/llm-usage"
          />

          <CollapsibleNavSection
            label="Cron Agent"
            icon={Timer}
            items={cronAgentItems}
            rootPath="/cron-agent"
            isOpen={s.isCronAgentOpen}
            onToggle={s.setIsCronAgentOpen}
            isCollapsed={s.isCollapsed}
            isActive={location.pathname.startsWith('/cron-agent')}
            navigateFallback="/cron-agent"
          />

          <CollapsibleNavSection
            label="Research Studio"
            icon={Sparkles}
            items={researchAgentItems}
            rootPath="/research"
            isOpen={s.isResearchAgentOpen}
            onToggle={s.setIsResearchAgentOpen}
            isCollapsed={s.isCollapsed}
            isActive={location.pathname.startsWith('/research')}
            navigateFallback="/research"
          />

          <CollapsibleNavSection
            label="Linear"
            icon={LayoutList}
            items={linearItems}
            rootPath="/linear"
            isOpen={s.isLinearOpen}
            onToggle={s.setIsLinearOpen}
            isCollapsed={s.isCollapsed}
            isActive={location.pathname.startsWith('/linear')}
            navigateFallback="/linear"
          />

          <TopLevelNavLink to="/calendar" label="Calendar" icon={Calendar} isCollapsed={s.isCollapsed} />
          <TopLevelNavLink to="/my-bookmarks" label="Bookmarks" icon={Bookmark} isCollapsed={s.isCollapsed} />
          <TopLevelNavLink to="/notes" label="WhatsApp" icon={MessageSquare} isCollapsed={s.isCollapsed} />

          <NotificationsSection
            isOpen={s.isNotificationsOpen}
            onToggle={s.setIsNotificationsOpen}
            isCollapsed={s.isCollapsed}
            savedFilters={s.savedFilters}
          />

          <TopLevelNavLink to="/my-notes" label="Notes" icon={StickyNote} isCollapsed={s.isCollapsed} />
          <TopLevelNavLink to="/my-todos" label="Checklists" icon={CheckSquare} isCollapsed={s.isCollapsed} />

          <CollapsibleNavSection
            label="Settings"
            icon={Settings}
            items={settingsItems}
            isOpen={s.isSettingsOpen}
            onToggle={s.setIsSettingsOpen}
            isCollapsed={s.isCollapsed}
            isActive={location.pathname.startsWith('/settings')}
            navigateOnOpen={false}
            exactMatchAllItems
          />
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
