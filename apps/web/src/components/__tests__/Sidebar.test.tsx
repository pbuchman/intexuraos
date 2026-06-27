/**
 * Tests for Sidebar component.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Battlefield as the first top-level NavLink before Digests', () => {
    render(
      <MemoryRouter initialEntries={['/code-tasks']}>
        <Sidebar />
      </MemoryRouter>
    );

    // Battlefield must be visible on initial mount (no group expansion required).
    const battlefieldLink = screen.getByRole('link', { name: /battlefield/i });
    expect(battlefieldLink).toBeInTheDocument();
    expect(battlefieldLink.getAttribute('href')).toMatch(/\/code-tasks$/);

    // Verify DOM order: Battlefield -> Digests.
    const digestsLink = screen.getByRole('link', { name: /digests/i });

    expect(
      battlefieldLink.compareDocumentPosition(digestsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('Battlefield link carries top-level styling (py-2.5, text-sm, font-medium, rounded-lg), not sub-item py-2', () => {
    render(
      <MemoryRouter initialEntries={['/code-tasks']}>
        <Sidebar />
      </MemoryRouter>
    );

    const battlefieldLink = screen.getByRole('link', { name: /battlefield/i });
    const classes = battlefieldLink.className.split(/\s+/);

    expect(classes).toContain('rounded-lg');
    expect(classes).toContain('py-2.5');
    expect(classes).toContain('text-sm');
    expect(classes).toContain('font-medium');
    // Sub-item padding must not be applied.
    expect(classes).not.toContain('py-2');
  });

  it('renders Digests as a top-level NavLink positioned between Battlefield and Hellscript', () => {
    render(
      <MemoryRouter initialEntries={['/notifications/digests']}>
        <Sidebar />
      </MemoryRouter>
    );

    // Digests must be visible on initial mount (no group expansion required).
    const digestsLink = screen.getByRole('link', { name: /digests/i });
    expect(digestsLink).toBeInTheDocument();
    expect(digestsLink.getAttribute('href')).toMatch(/\/notifications\/digests$/);

    // Verify DOM order: Battlefield -> Digests -> Hellscript group trigger.
    const battlefieldLink = screen.getByRole('link', { name: /battlefield/i });
    const hellscriptTrigger = screen.getByRole('button', { name: /hellscript/i });

    expect(
      battlefieldLink.compareDocumentPosition(digestsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      digestsLink.compareDocumentPosition(hellscriptTrigger) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('Digests link carries top-level styling (py-2.5, text-sm, font-medium, rounded-lg), not sub-item py-2', () => {
    render(
      <MemoryRouter initialEntries={['/notifications/digests']}>
        <Sidebar />
      </MemoryRouter>
    );

    const digestsLink = screen.getByRole('link', { name: /digests/i });
    const classes = digestsLink.className.split(/\s+/);

    expect(classes).toContain('rounded-lg');
    expect(classes).toContain('py-2.5');
    expect(classes).toContain('text-sm');
    expect(classes).toContain('font-medium');
    // Sub-item padding must not be applied.
    expect(classes).not.toContain('py-2');
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

  it('renders WhatsApp as an expanded section with Assistant, Sessions, and Private entries', () => {
    render(
      <MemoryRouter initialEntries={['/whatsapp/private']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /^whatsapp$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /assistant/i })).toHaveAttribute(
      'href',
      '/whatsapp/assistant'
    );
    expect(screen.getByRole('link', { name: /sessions/i })).toHaveAttribute(
      'href',
      '/whatsapp/sessions'
    );
    expect(screen.getByRole('link', { name: /private/i })).toHaveAttribute(
      'href',
      '/whatsapp/private'
    );
    expect(screen.queryByRole('link', { name: /^whatsapp$/i })).not.toBeInTheDocument();
  });

  it('renders the INTEX Agent section with Configuration and Sessions entries', () => {
    render(
      <MemoryRouter initialEntries={['/intex-agent/config']}>
        <Sidebar />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /intex agent/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /configuration/i })).toHaveAttribute(
      'href',
      '/intex-agent/config'
    );
    expect(screen.getByRole('link', { name: /^sessions$/i })).toHaveAttribute(
      'href',
      '/whatsapp/sessions'
    );
  });
});
