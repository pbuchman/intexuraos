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

  it('renders Digests as a top-level NavLink without expanding Mobile, positioned between Inbox and Hellscript', () => {
    render(
      <MemoryRouter initialEntries={['/inbox']}>
        <Sidebar />
      </MemoryRouter>
    );

    // Digests must be visible on initial mount (no group expansion required).
    const digestsLink = screen.getByRole('link', { name: /digests/i });
    expect(digestsLink).toBeInTheDocument();
    expect(digestsLink.getAttribute('href')).toMatch(/\/notifications\/digests$/);

    // Verify DOM order: Inbox -> Digests -> Hellscript group trigger.
    const inboxLink = screen.getByRole('link', { name: /inbox/i });
    const hellscriptTrigger = screen.getByRole('button', { name: /hellscript/i });

    expect(
      inboxLink.compareDocumentPosition(digestsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      digestsLink.compareDocumentPosition(hellscriptTrigger) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('Digests link carries top-level styling (py-2.5, text-sm, font-medium, rounded-lg), not sub-item py-2', () => {
    render(
      <MemoryRouter initialEntries={['/inbox']}>
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
});
