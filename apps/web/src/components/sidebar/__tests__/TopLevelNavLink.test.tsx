/**
 * Smoke tests for TopLevelNavLink.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StickyNote } from 'lucide-react';
import { TopLevelNavLink } from '../TopLevelNavLink.js';

describe('TopLevelNavLink', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the label when not collapsed', () => {
    render(
      <MemoryRouter>
        <TopLevelNavLink to="/my-notes" label="Notes" icon={StickyNote} isCollapsed={false} />
      </MemoryRouter>
    );
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('hides label when collapsed', () => {
    render(
      <MemoryRouter>
        <TopLevelNavLink to="/my-notes" label="Notes" icon={StickyNote} isCollapsed={true} />
      </MemoryRouter>
    );
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });

  it('renders link with correct href', () => {
    render(
      <MemoryRouter>
        <TopLevelNavLink to="/calendar" label="Calendar" icon={StickyNote} isCollapsed={false} />
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: /calendar/i });
    expect(link.getAttribute('href')).toMatch(/\/calendar$/);
  });
});
