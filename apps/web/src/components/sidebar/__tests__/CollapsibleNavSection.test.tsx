/**
 * Smoke tests for CollapsibleNavSection.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { List, Plus, Settings } from 'lucide-react';
import { CollapsibleNavSection } from '../CollapsibleNavSection.js';
import type { NavItem } from '../navItems.js';

const items: NavItem[] = [
  { to: '/foo', label: 'Foo', icon: List },
  { to: '/foo/new', label: 'New', icon: Plus },
];

describe('CollapsibleNavSection', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the section label and toggles open', () => {
    render(
      <MemoryRouter>
        <CollapsibleNavSection
          label="Foo"
          icon={Settings}
          items={items}
          isOpen={true}
          onToggle={vi.fn()}
          isCollapsed={false}
          isActive={false}
          rootPath="/foo"
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /foo/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^foo$/i }).getAttribute('href')).toMatch(/\/foo$/);
    expect(screen.getByRole('link', { name: /new/i })).toBeInTheDocument();
  });

  it('hides sub-items when closed', () => {
    render(
      <MemoryRouter>
        <CollapsibleNavSection
          label="Foo"
          icon={Settings}
          items={items}
          isOpen={false}
          onToggle={vi.fn()}
          isCollapsed={false}
          isActive={false}
          rootPath="/foo"
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: /new/i })).not.toBeInTheDocument();
  });

  it('hides sub-items when sidebar is collapsed', () => {
    render(
      <MemoryRouter>
        <CollapsibleNavSection
          label="Foo"
          icon={Settings}
          items={items}
          isOpen={true}
          onToggle={vi.fn()}
          isCollapsed={true}
          isActive={false}
          rootPath="/foo"
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: /new/i })).not.toBeInTheDocument();
  });
});
