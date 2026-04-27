/**
 * Smoke tests for TopLevelNavLink.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { TopLevelNavLink } from '../TopLevelNavLink.js';

describe('TopLevelNavLink', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the label when not collapsed', () => {
    render(
      <MemoryRouter>
        <TopLevelNavLink to="/inbox" label="Inbox" icon={Inbox} isCollapsed={false} />
      </MemoryRouter>
    );
    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });

  it('hides label when collapsed', () => {
    render(
      <MemoryRouter>
        <TopLevelNavLink to="/inbox" label="Inbox" icon={Inbox} isCollapsed={true} />
      </MemoryRouter>
    );
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
  });

  it('renders link with correct href', () => {
    render(
      <MemoryRouter>
        <TopLevelNavLink to="/calendar" label="Calendar" icon={Inbox} isCollapsed={false} />
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: /calendar/i });
    expect(link.getAttribute('href')).toMatch(/\/calendar$/);
  });
});
