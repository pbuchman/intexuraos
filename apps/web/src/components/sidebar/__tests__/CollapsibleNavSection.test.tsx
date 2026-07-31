/**
 * Smoke tests for CollapsibleNavSection.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { List, Plus, Settings } from 'lucide-react';
import { CollapsibleNavSection } from '../CollapsibleNavSection.js';
import type { NavItem } from '../navItems.js';

const items: NavItem[] = [
  { to: '/foo', label: 'Foo', icon: List },
  { to: '/foo/new', label: 'New', icon: Plus },
];

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

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
          rootPath="/foo"
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: /new/i })).not.toBeInTheDocument();
  });

  it('hides sub-items before interaction when sidebar is collapsed', () => {
    render(
      <MemoryRouter>
        <CollapsibleNavSection
          label="Foo"
          icon={Settings}
          items={items}
          isOpen={true}
          onToggle={vi.fn()}
          isCollapsed={true}
          rootPath="/foo"
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: /new/i })).not.toBeInTheDocument();
  });

  it('requests sidebar expansion when opening a collapsed top-level section', () => {
    const onToggle = vi.fn();
    const onCollapsedOpen = vi.fn();

    render(
      <MemoryRouter initialEntries={['/current']}>
        <CollapsibleNavSection
          label="Foo"
          icon={Settings}
          items={items}
          isOpen={false}
          onToggle={onToggle}
          onCollapsedOpen={onCollapsedOpen}
          isCollapsed={true}
          rootPath="/foo"
        />
        <LocationProbe />
      </MemoryRouter>
    );

    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    expect(onToggle).toHaveBeenCalledWith(true);
    expect(onCollapsedOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location')).toHaveTextContent('/current');
  });

  it('expands without navigating when opening a top-level section', () => {
    const onToggle = vi.fn();

    render(
      <MemoryRouter initialEntries={['/current']}>
        <CollapsibleNavSection
          label="Foo"
          icon={Settings}
          items={items}
          isOpen={false}
          onToggle={onToggle}
          isCollapsed={false}
          rootPath="/foo"
        />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /foo/i }));

    expect(onToggle).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('location')).toHaveTextContent('/current');
  });

  it('opens by keyboard, closes by pointer, and exposes the expanded state', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <CollapsibleNavSection
          label="WhatsApp"
          icon={Settings}
          items={items}
          isOpen={false}
          onToggle={onToggle}
          isCollapsed={false}
          rootPath="/foo"
        />
      </MemoryRouter>
    );

    const trigger = screen.getByRole('button', { name: 'WhatsApp' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(onToggle).toHaveBeenLastCalledWith(true);

    rerender(
      <MemoryRouter>
        <CollapsibleNavSection
          label="WhatsApp"
          icon={Settings}
          items={items}
          isOpen
          onToggle={onToggle}
          isCollapsed={false}
          rootPath="/foo"
        />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await user.click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });
});
