import { describe, expect, it } from 'vitest';

// @ts-expect-error vite raw import has no type declaration
import appSource from '../App.tsx?raw'; // @allow-missing-js -- vite '?raw' query import
// @ts-expect-error vite raw import has no type declaration
import sidebarSource from '../components/Sidebar.tsx?raw'; // @allow-missing-js -- vite '?raw' query import
// @ts-expect-error vite raw import has no type declaration
import collapsibleSectionSource from '../components/sidebar/CollapsibleNavSection.tsx?raw'; // @allow-missing-js -- vite '?raw' query import
// @ts-expect-error vite raw import has no type declaration
import notificationsSectionSource from '../components/sidebar/NotificationsSection.tsx?raw'; // @allow-missing-js -- vite '?raw' query import
// @ts-expect-error vite raw import has no type declaration
import navItemsSource from '../components/sidebar/navItems.ts?raw'; // @allow-missing-js -- vite '?raw' query import

describe('navigation structure', () => {
  it('keeps submenu parents as non-navigating toggles', () => {
    expect(collapsibleSectionSource).not.toContain('useNavigate');
    expect(collapsibleSectionSource).not.toContain('navigateOnOpen');
    expect(collapsibleSectionSource).not.toContain('navigateFallback');
    expect(notificationsSectionSource).not.toContain("navigate('/notifications'");
  });

  it('keeps promoted items inside their owning submenus', () => {
    expect(sidebarSource).not.toContain('label="Battlefield"');
    expect(sidebarSource).not.toContain('label="Message Digests"');
    expect(navItemsSource).toMatch(
      /export const codeTasksItems[\s\S]*to: '\/code-tasks', label: 'Battlefield'/
    );
    expect(navItemsSource).toMatch(
      /export const whatsappItems[\s\S]*to: '\/whatsapp\/message-digests', label: 'Message Digests'/
    );
    expect(notificationsSectionSource).not.toContain('/notifications/digests');
    expect(navItemsSource).not.toContain("to: '/whatsapp/sessions'");
    expect(navItemsSource).not.toContain("to: '/fishing-assistant/digests'");
    expect(navItemsSource).not.toContain("label: 'Current Digests'");
  });

  it('keeps Intex Agent first and sessions as the authenticated landing route', () => {
    expect(sidebarSource.indexOf('label="Intex Agent"')).toBeLessThan(
      sidebarSource.indexOf('label="Code Tasks"')
    );
    expect(navItemsSource).toMatch(
      /export const intexAgentItems[\s\S]*to: '\/intex-agent\/sessions', label: 'Sessions'/
    );
    expect(appSource).toContain('to="/intex-agent/sessions"');
    expect(appSource).toContain('path="/whatsapp/sessions"');
    expect(appSource).toContain('to="/intex-agent/sessions" replace');
  });
});
