/**
 * Tests for Sidebar component.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../Sidebar.js';

const mockGetAccessToken = vi.fn();

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services/mobileNotificationsApi', () => ({
  getNotificationFilters: vi.fn().mockResolvedValue({ savedFilters: [] }),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Intex Agent as the first menu section with Sessions first', () => {
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions']}>
        <Sidebar />
      </MemoryRouter>
    );

    const intexAgentTrigger = screen.getByRole('button', { name: /intex agent/i });
    const codeTasksTrigger = screen.getByRole('button', { name: /code tasks/i });

    expect(
      intexAgentTrigger.compareDocumentPosition(codeTasksTrigger) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /^sessions$/i })).toHaveAttribute(
      'href',
      '/intex-agent/sessions'
    );
    expect(screen.getByRole('link', { name: /preferences/i })).toHaveAttribute(
      'href',
      '/intex-agent/preferences'
    );
  });

  it('renders Battlefield as the first Code Tasks sub-item instead of a top-level link', () => {
    render(
      <MemoryRouter initialEntries={['/code-tasks']}>
        <Sidebar />
      </MemoryRouter>
    );

    const codeTasksTrigger = screen.getByRole('button', { name: /code tasks/i });
    const battlefieldLink = screen.getByRole('link', { name: /^battlefield$/i });
    const newTaskLink = screen.getByRole('link', { name: /new task/i });

    expect(battlefieldLink).toHaveAttribute('href', '/code-tasks');
    expect(battlefieldLink.className.split(/\s+/)).toContain('py-2');
    expect(battlefieldLink.className.split(/\s+/)).not.toContain('py-2.5');
    expect(
      codeTasksTrigger.compareDocumentPosition(battlefieldLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      battlefieldLink.compareDocumentPosition(newTaskLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders Digests inside the Mobile section instead of as a top-level link', () => {
    render(
      <MemoryRouter initialEntries={['/notifications/digests']}>
        <Sidebar />
      </MemoryRouter>
    );

    const digestsLink = screen.getByRole('link', { name: /digests/i });
    const mobileTrigger = screen.getByRole('button', { name: /^mobile$/i });

    expect(digestsLink).toHaveAttribute('href', '/notifications/digests');
    expect(mobileTrigger.className).not.toContain('bg-blue-50');
    expect(
      mobileTrigger.compareDocumentPosition(digestsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('opens Mobile sub-items from the mobile drawer when the persisted sidebar is collapsed', () => {
    localStorage.setItem('sidebar-collapsed', 'true');

    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <Sidebar />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    fireEvent.click(screen.getByRole('button', { name: /^mobile$/i }));

    expect(screen.getByRole('link', { name: /digests/i })).toHaveAttribute(
      'href',
      '/notifications/digests'
    );
  });

  it('opens Code Tasks sub-items from the collapsed desktop sidebar without navigation', () => {
    localStorage.setItem('sidebar-collapsed', 'true');

    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <Sidebar />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /code tasks/i }));

    expect(screen.getByRole('link', { name: /^battlefield$/i })).toHaveAttribute(
      'href',
      '/code-tasks'
    );
    expect(screen.getByRole('link', { name: /^calendar$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('marks only the matching Code Tasks sub-item active on deep links', () => {
    render(
      <MemoryRouter initialEntries={['/code-tasks/new']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /^new task$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('button', { name: /code tasks/i }).className).not.toContain(
      'bg-blue-50'
    );
    expect(screen.getByRole('link', { name: /^battlefield$/i })).not.toHaveAttribute(
      'aria-current'
    );
  });

  it('marks only the matching WhatsApp sub-item active on deep links', () => {
    render(
      <MemoryRouter initialEntries={['/whatsapp/private']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /^private$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('button', { name: /^whatsapp$/i }).className).not.toContain(
      'bg-blue-50'
    );
    expect(screen.getByRole('link', { name: /^assistant$/i })).not.toHaveAttribute(
      'aria-current'
    );
  });

  it('marks only the matching Intex Agent sub-item active on deep links', () => {
    render(
      <MemoryRouter initialEntries={['/intex-agent/preferences']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /^preferences$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('button', { name: /intex agent/i }).className).not.toContain(
      'bg-blue-50'
    );
    expect(screen.getByRole('link', { name: /^sessions$/i })).not.toHaveAttribute(
      'aria-current'
    );
  });

  it('renders the Fishing Assistant section with digest, knowledge, and chat entries', () => {
    render(
      <MemoryRouter initialEntries={['/fishing-assistant/digests']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /fishing assistant/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /current digests/i })).toHaveAttribute(
      'href',
      '/fishing-assistant/digests'
    );
    expect(screen.getByRole('link', { name: /knowledge base/i })).toHaveAttribute(
      'href',
      '/fishing-assistant/knowledge'
    );
    expect(screen.getByRole('link', { name: /^chat$/i })).toHaveAttribute(
      'href',
      '/fishing-assistant/chat'
    );
  });

  it('renders WhatsApp as an expanded section with Assistant, Private, and Conversation Assistant entries', () => {
    render(
      <MemoryRouter initialEntries={['/whatsapp/private']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /^whatsapp$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^assistant$/i })).toHaveAttribute(
      'href',
      '/whatsapp/assistant'
    );
    expect(screen.getByRole('link', { name: /^conversation assistant$/i })).toHaveAttribute(
      'href',
      '/whatsapp/conversation-assistant'
    );
    expect(screen.queryByRole('link', { name: /sessions/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /private/i })).toHaveAttribute(
      'href',
      '/whatsapp/private'
    );
    expect(screen.queryByRole('link', { name: /^whatsapp$/i })).not.toBeInTheDocument();
  });

  it('renders the Intex Agent section with Sessions and Preferences entries', () => {
    render(
      <MemoryRouter initialEntries={['/intex-agent/preferences']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /intex agent/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^sessions$/i })).toHaveAttribute(
      'href',
      '/intex-agent/sessions'
    );
    expect(screen.getByRole('link', { name: /preferences/i })).toHaveAttribute(
      'href',
      '/intex-agent/preferences'
    );
  });
});
