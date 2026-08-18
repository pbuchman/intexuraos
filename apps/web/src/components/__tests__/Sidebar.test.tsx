/**
 * Tests for Sidebar component.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { getNotificationFilters } from '@/services/mobileNotificationsApi';
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
    vi.mocked(getNotificationFilters).mockResolvedValue({
      options: { app: [], device: [], source: [] },
      savedFilters: [],
    });
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
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute(
      'href',
      '/intex-agent/settings'
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

  it('renders Message Digests inside WhatsApp and removes digest navigation from Mobile', () => {
    render(
      <MemoryRouter initialEntries={['/whatsapp/message-digests/definition/history/run']}>
        <Sidebar />
      </MemoryRouter>
    );

    const digestsLink = screen.getByRole('link', { name: /^message digests$/i });
    const whatsappTrigger = screen.getByRole('button', { name: /^whatsapp$/i });
    const mobileTrigger = screen.getByRole('button', { name: /^mobile$/i });

    expect(digestsLink).toHaveAttribute('href', '/whatsapp/message-digests');
    expect(digestsLink).toHaveAttribute('aria-current', 'page');
    expect(
      whatsappTrigger.compareDocumentPosition(digestsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(mobileTrigger);
    expect(screen.queryByRole('link', { name: /^digests$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^message digests$/i })).toBe(digestsLink);
  });

  it.each([
    '/whatsapp/message-digests',
    '/whatsapp/message-digests/new',
    '/whatsapp/message-digests/digest-a',
    '/whatsapp/message-digests/digest-a/edit',
    '/whatsapp/message-digests/digest-a/history',
    '/whatsapp/message-digests/digest-a/history/run-a',
  ])('keeps Message Digests active and WhatsApp expanded on nested route %s', (route) => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: 'WhatsApp' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByRole('link', { name: 'Message Digests' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('keeps unrelated Mobile links and saved filters working without legacy Digests', async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationFilters).mockResolvedValue({
      options: { app: ['Messages'], device: ['Phone'], source: ['Personal'] },
      savedFilters: [
        {
          id: 'filter-important',
          name: 'Important mobile',
          app: ['Messages'],
          createdAt: '2026-07-27T12:00:00.000Z',
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <Sidebar />
        <LocationProbe />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/notifications');
    expect(screen.queryByRole('link', { name: /digests/i })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Important mobile' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/notifications?filterId=filter-important&app=Messages'
    );
  });

  it('opens Mobile filters without a legacy digest link when the persisted sidebar is collapsed', () => {
    localStorage.setItem('sidebar-collapsed', 'true');

    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <Sidebar />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    fireEvent.click(screen.getByRole('button', { name: /^mobile$/i }));

    expect(screen.getByRole('link', { name: /^all$/i })).toHaveAttribute('href', '/notifications');
    expect(screen.queryByRole('link', { name: /digests/i })).not.toBeInTheDocument();
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
      <MemoryRouter initialEntries={['/intex-agent/settings']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /^settings$/i })).toHaveAttribute(
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

  it('renders Fishing knowledge and chat without a duplicate digest entry', () => {
    render(
      <MemoryRouter initialEntries={['/fishing-assistant/knowledge']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /fishing assistant/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /current digests/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /knowledge base/i })).toHaveAttribute(
      'href',
      '/fishing-assistant/knowledge'
    );
    expect(screen.getByRole('link', { name: /^chat$/i })).toHaveAttribute(
      'href',
      '/fishing-assistant/chat'
    );
  });

  it('renders WhatsApp as an expanded section with Assistant, Private, Message Digests, and Conversation Assistant entries', () => {
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
    expect(screen.getByRole('link', { name: /^message digests$/i })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests'
    );
    expect(screen.queryByRole('link', { name: /sessions/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /private/i })).toHaveAttribute(
      'href',
      '/whatsapp/private'
    );
    expect(screen.queryByRole('link', { name: /^whatsapp$/i })).not.toBeInTheDocument();
  });

  it('renders the Intex Agent section with Sessions and Settings entries', () => {
    render(
      <MemoryRouter initialEntries={['/intex-agent/settings']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /intex agent/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^sessions$/i })).toHaveAttribute(
      'href',
      '/intex-agent/sessions'
    );
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute(
      'href',
      '/intex-agent/settings'
    );
  });
});

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}
