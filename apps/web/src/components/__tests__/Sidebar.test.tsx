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

  it('renders a Digests link to /notifications/digests when Notifications group is expanded', async () => {
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <Sidebar />
      </MemoryRouter>
    );

    const digestsLink = await screen.findByRole('link', { name: /digests/i });
    expect(digestsLink).toBeInTheDocument();
    expect(digestsLink.getAttribute('href')).toMatch(/\/notifications\/digests$/);
  });

  it('Digests link has NavLink sub-item styling classes', async () => {
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <Sidebar />
      </MemoryRouter>
    );

    const digestsLink = await screen.findByRole('link', { name: /digests/i });
    // Matches the sub-item styling shared with "All" link (rounded-lg + px-3 py-2 + text-sm).
    expect(digestsLink.className).toContain('rounded-lg');
    expect(digestsLink.className).toContain('px-3');
    expect(digestsLink.className).toContain('py-2');
    expect(digestsLink.className).toContain('text-sm');
  });
});
