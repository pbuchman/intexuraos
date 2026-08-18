import {
  Bell,
  Bot,
  Calendar,
  Clock,
  Crosshair,
  DollarSign,
  FileText,
  GitBranch,
  GitMerge,
  Key,
  Library,
  LayoutList,
  List,
  MessagesSquare,
  MessageCircle,
  Newspaper,
  PenTool,
  Plus,
  RadioTower,
  Scissors,
  Server,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { SavedNotificationFilter } from '@/types';

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const settingsItems: NavItem[] = [
  { to: '/settings/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { to: '/settings/mobile', label: 'Mobile', icon: Bell },
  { to: '/settings/notion', label: 'Notion', icon: FileText },
  { to: '/settings/calendar', label: 'Google Calendar', icon: Calendar },
  { to: '/settings/linear', label: 'Linear', icon: LayoutList },
  { to: '/settings/github', label: 'GitHub', icon: GitBranch },
  { to: '/settings/code', label: 'Code Settings', icon: Server },
  { to: '/settings/api-keys', label: 'API Keys', icon: Key },
];

export const whatsappItems: NavItem[] = [
  { to: '/whatsapp/assistant', label: 'Assistant', icon: MessageCircle },
  { to: '/whatsapp/private', label: 'Private', icon: MessagesSquare },
  { to: '/whatsapp/message-digests', label: 'Message Digests', icon: Newspaper },
  { to: '/whatsapp/conversation-assistant', label: 'Conversation Assistant', icon: Bot },
];

export const researchAgentItems: NavItem[] = [
  { to: '/research', label: 'Library', icon: List },
  { to: '/research/new', label: 'New Study', icon: Plus },
];

export const hellscriptItems: NavItem[] = [
  { to: '/hellscript', label: 'Infernal Whispers', icon: List },
  { to: '/hellscript/new', label: 'Summon', icon: Plus },
  { to: '/hellscript/voice', label: 'Voice of the Damned', icon: PenTool },
  { to: '/hellscript/scriptures', label: 'Sacred Scriptures', icon: FileText },
];

export const codeTasksItems: NavItem[] = [
  { to: '/code-tasks', label: 'Battlefield', icon: Crosshair },
  { to: '/code-tasks/new', label: 'New Task', icon: Plus },
  { to: '/code-tasks/ask-agent', label: 'Ask Agent', icon: Bot },
  { to: '/code-tasks/dispatch-queue', label: 'Dispatch Queue', icon: Clock },
  { to: '/code-tasks/pr-events', label: 'GitHub Event Log', icon: RadioTower },
  { to: '/code-tasks/merge-queue', label: 'Merge Queue', icon: GitMerge },
];

export const linearItems: NavItem[] = [
  { to: '/linear', label: 'Dashboard', icon: List },
  { to: '/linear/prune-candidates', label: 'Issue Cleanup', icon: Scissors },
];

export const llmUsageItems: NavItem[] = [
  { to: '/llm-usage', label: 'Events', icon: List },
  { to: '/llm-usage/pricing', label: 'Pricing', icon: DollarSign },
];

export const fishingAssistantItems: NavItem[] = [
  { to: '/fishing-assistant/knowledge', label: 'Knowledge Base', icon: Library },
  { to: '/fishing-assistant/chat', label: 'Chat', icon: MessageCircle },
];

export const intexAgentItems: NavItem[] = [
  { to: '/intex-agent/sessions', label: 'Sessions', icon: List },
  { to: '/intex-agent/settings', label: 'Settings', icon: SettingsIcon },
];

/**
 * Build URL search params from a saved notification filter.
 * Arrays are joined with commas for URL encoding.
 * Includes filterId to track which filter was explicitly selected.
 */
export function buildFilterUrl(filter: SavedNotificationFilter): string {
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
export function filterMatchesUrl(filter: SavedNotificationFilter, search: string): boolean {
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
