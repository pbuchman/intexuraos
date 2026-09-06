/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageDigestDefinition } from '@/types/messageDigests';
import { MessageDigestActionsMenu } from '../MessageDigestActionsMenu.js';

describe('MessageDigestActionsMenu', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.style.fontSize = '';
  });

  it.each([
    ['active', 'Pause digest'],
    ['paused', 'Resume digest'],
  ] as const)('isolates the %s lifecycle action from every other mutation', async (status, label) => {
    const user = userEvent.setup();
    const onToggleLifecycle = vi.fn();
    const onRun = vi.fn();
    const onDelete = vi.fn();
    const item = definition(status);
    renderMenu({ item, onToggleLifecycle, onRun, onDelete });

    await user.click(screen.getByRole('button', { name: `Actions for ${item.name}` }));
    await user.click(screen.getByRole('menuitem', { name: label }));

    expect(onToggleLifecycle).toHaveBeenCalledWith(item, 'pointer');
    expect(onRun).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('restores keyboard focus after lifecycle completion without stealing pointer focus', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/whatsapp/message-digests']}>
        <LifecycleFocusHarness />
      </MemoryRouter>
    );

    const trigger = screen.getByRole('button', { name: 'Actions for Digest active' });
    await user.click(trigger);
    const lifecycleItem = screen.getByRole('menuitem', { name: 'Pause digest' });
    lifecycleItem.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Pausing Digest active…' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Finish lifecycle' }));
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Pause digest' }));
    const finish = screen.getByRole('button', { name: 'Finish lifecycle' });
    await user.click(finish);
    await waitFor(() => expect(finish).toHaveFocus());
  });

  it('defers keyboard focus return until a lifecycle refresh requirement clears', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/whatsapp/message-digests']}>
        <LifecycleFocusHarness />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Actions for Digest active' }));
    const lifecycleItem = screen.getByRole('menuitem', { name: 'Pause digest' });
    lifecycleItem.focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Require refresh' }));

    expect(
      screen.getByRole('button', { name: 'Refresh required for Digest active' })
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Clear refresh requirement' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Actions for Digest active' })).toHaveFocus()
    );
  });

  it.each([
    ['pause', 'Pausing Digest active…'],
    ['resume', 'Resuming Digest active…'],
  ] as const)('locks every row action while %s is pending', (pendingLifecycle, label) => {
    renderMenu({ item: definition('active'), pendingLifecycle });

    const trigger = screen.getByRole('button', { name: label });
    expect(trigger).toBeDisabled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps View available but disables unsafe mutations during deletion', async () => {
    const user = userEvent.setup();
    const item = definition('deleting');
    renderMenu({ item });

    await user.click(screen.getByRole('button', { name: `Actions for ${item.name}` }));

    expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveAttribute(
      'href',
      `/whatsapp/message-digests/${item.id}`
    );
    for (const name of ['Edit', 'Run now', 'Pause digest', 'Delete digest']) {
      expect(screen.getByRole('menuitem', { name })).toBeDisabled();
    }
  });

  it('portals and collision-positions the menu, then recomputes on viewport changes', async () => {
    vi.stubGlobal('innerWidth', 1_024);
    vi.stubGlobal('innerHeight', 768);
    let triggerRect = domRect({ top: 720, right: 48, bottom: 764, left: 4, width: 44, height: 44 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.getAttribute('aria-haspopup') === 'menu') return triggerRect;
      if (this.getAttribute('role') === 'menu') {
        return domRect({ top: 0, right: 256, bottom: 300, left: 0, width: 256, height: 300 });
      }
      return domRect({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 });
    });
    const item = definition('active');
    const view = renderMenu({ item });

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: `Actions for ${item.name}` }));
    const menu = await screen.findByRole('menu');

    expect(menu.parentElement).toBe(document.body);
    expect(view.container).not.toContainElement(menu);
    expect(menu).toHaveClass('fixed');
    expect(menu).toHaveStyle({ top: '416px', left: '8px' });

    triggerRect = domRect({ top: 20, right: 944, bottom: 64, left: 900, width: 44, height: 44 });
    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(menu).toHaveStyle({ top: '68px', left: '688px' }));

    triggerRect = domRect({ top: 30, right: 900, bottom: 74, left: 856, width: 44, height: 44 });
    window.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(menu).toHaveStyle({ top: '78px', left: '644px' }));
  });

  it('keeps every portaled action reachable at 200% zoom in a short mobile viewport', async () => {
    document.documentElement.style.fontSize = '200%';
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 320);
    const item = definition('paused');
    renderMenu({
      item,
      lifecycleDisabledReason:
        'WhatsApp delivery must be ready before this Message Digest can be resumed.',
    });

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: `Actions for ${item.name}` }));
    const menu = await screen.findByRole('menu');

    expect(menu).toHaveClass(
      'max-h-[calc(100dvh-1rem)]',
      'max-w-[calc(100vw-1rem)]',
      'overflow-x-hidden',
      'overflow-y-auto',
      'overscroll-contain'
    );
    for (const action of within(menu).getAllByRole('menuitem')) {
      expect(action).toHaveClass('min-h-11');
    }

    await userEvent.setup().keyboard('{End}');
    expect(within(menu).getByRole('menuitem', { name: 'Delete digest' })).toHaveFocus();
  });

  it.each([
    ['Run now', 'run'],
    ['Delete digest', 'delete'],
  ] as const)('invokes only the declared %s mutation', async (label, expectedMutation) => {
    const user = userEvent.setup();
    const onToggleLifecycle = vi.fn();
    const onRun = vi.fn();
    const onDelete = vi.fn();
    const item = definition('active');
    renderMenu({ item, onToggleLifecycle, onRun, onDelete });

    await user.click(screen.getByRole('button', { name: `Actions for ${item.name}` }));
    await user.click(screen.getByRole('menuitem', { name: label }));

    expect(onRun).toHaveBeenCalledTimes(expectedMutation === 'run' ? 1 : 0);
    expect(onDelete).toHaveBeenCalledTimes(expectedMutation === 'delete' ? 1 : 0);
    expect(onToggleLifecycle).not.toHaveBeenCalled();
  });

  it('closes on Escape and outside pointer interaction and restores trigger focus', async () => {
    const user = userEvent.setup();
    const item = definition('active');
    renderMenu({ item });
    const trigger = screen.getByRole('button', { name: `Actions for ${item.name}` });

    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Outside control' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('moves focus with Arrow keys, Home, and End and wraps across enabled items', async () => {
    const user = userEvent.setup();
    const item = definition('active');
    renderMenu({ item });

    await user.click(screen.getByRole('button', { name: `Actions for ${item.name}` }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveFocus());

    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Delete digest' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Delete digest' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('skips disabled Run and Resume items during keyboard traversal', async () => {
    const user = userEvent.setup();
    const item = definition('paused');
    renderMenu({
      item,
      lifecycleDisabledReason: 'WhatsApp delivery must be ready before resuming.',
    });

    await user.click(screen.getByRole('button', { name: `Actions for ${item.name}` }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete digest' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'View details' })).toHaveFocus();
  });

  it.each([
    ['View details', 'view'],
    ['Edit', 'edit'],
    ['Run now', 'run'],
    ['Pause digest', 'pause'],
    ['Delete digest', 'delete'],
  ] as const)('activates the enabled %s action with Enter', async (label, expectedAction) => {
    const user = userEvent.setup();
    const onToggleLifecycle = vi.fn();
    const onRun = vi.fn();
    const onDelete = vi.fn();
    const item = definition('active');
    renderMenu({ item, onToggleLifecycle, onRun, onDelete });

    await user.click(screen.getByRole('button', { name: `Actions for ${item.name}` }));
    const menuItem = screen.getByRole('menuitem', { name: label });
    menuItem.focus();
    await user.keyboard('{Enter}');

    if (expectedAction === 'view') {
      expect(screen.getByTestId('menu-location')).toHaveTextContent(
        `/whatsapp/message-digests/${item.id}`
      );
    } else if (expectedAction === 'edit') {
      expect(screen.getByTestId('menu-location')).toHaveTextContent(
        `/whatsapp/message-digests/${item.id}/edit`
      );
    } else {
      expect(onRun).toHaveBeenCalledTimes(expectedAction === 'run' ? 1 : 0);
      expect(onToggleLifecycle).toHaveBeenCalledTimes(expectedAction === 'pause' ? 1 : 0);
      expect(onDelete).toHaveBeenCalledTimes(expectedAction === 'delete' ? 1 : 0);
    }
  });
});

function renderMenu({
  item,
  pendingLifecycle = null,
  onToggleLifecycle = vi.fn(),
  onRun = vi.fn(),
  onDelete = vi.fn(),
  lifecycleDisabledReason = null,
}: {
  item: MessageDigestDefinition;
  pendingLifecycle?: 'pause' | 'resume' | null;
  onToggleLifecycle?: (definition: MessageDigestDefinition) => void;
  onRun?: (definition: MessageDigestDefinition) => void;
  onDelete?: (definition: MessageDigestDefinition) => void;
  lifecycleDisabledReason?: string | null;
}): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/whatsapp/message-digests']}>
      <MenuLocation />
      <button type="button">Outside control</button>
      <MessageDigestActionsMenu
        definition={item}
        runDisabledReason={item.status === 'paused' ? 'Resume this digest before running it.' : null}
        lifecycleDisabledReason={lifecycleDisabledReason}
        deleteDisabledReason={null}
        pendingLifecycle={pendingLifecycle}
        refreshRequired={false}
        onToggleLifecycle={onToggleLifecycle}
        onRun={onRun}
        onDelete={onDelete}
      />
    </MemoryRouter>
  );
}

function MenuLocation(): React.JSX.Element {
  return <span data-testid="menu-location">{useLocation().pathname}</span>;
}

function LifecycleFocusHarness(): React.JSX.Element {
  const [pendingLifecycle, setPendingLifecycle] = useState<'pause' | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const item = definition('active');
  return (
    <>
      <button
        type="button"
        onClick={(): void => {
          setPendingLifecycle(null);
          setRefreshRequired(false);
        }}
      >
        Finish lifecycle
      </button>
      <button
        type="button"
        onClick={(): void => {
          setPendingLifecycle(null);
          setRefreshRequired(true);
        }}
      >
        Require refresh
      </button>
      <button type="button" onClick={(): void => setRefreshRequired(false)}>
        Clear refresh requirement
      </button>
      <MessageDigestActionsMenu
        definition={item}
        runDisabledReason={null}
        lifecycleDisabledReason={null}
        deleteDisabledReason={null}
        pendingLifecycle={pendingLifecycle}
        refreshRequired={refreshRequired}
        onToggleLifecycle={(): void => {
          setRefreshRequired(false);
          setPendingLifecycle('pause');
        }}
        onRun={vi.fn()}
        onDelete={vi.fn()}
      />
    </>
  );
}

function definition(status: MessageDigestDefinition['status']): MessageDigestDefinition {
  return {
    id: `digest-${status}`,
    name: `Digest ${status}`,
    status,
    listStatus: status === 'active' ? 'active' : 'paused',
    attentionCode: null,
    revision: 3,
    sourceLocked: false,
    source: { chatId: 'chat-1', chatType: 'group', displayName: 'Fishing group' },
    instructions: { templateId: 'custom', text: 'Summarize supported conversation facts.' },
    schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
    delivery: { type: 'whatsapp_primary' },
    checkpointAt: '2026-07-27T05:30:00.000Z',
    nextRunAt: '2026-07-28T05:30:00.000Z',
    lastRunAt: null,
    latestRun: null,
    createdAt: '2026-07-27T12:00:00.000Z',
    updatedAt: '2026-07-27T12:00:00.000Z',
  };
}

function domRect(input: {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    ...input,
    x: input.left,
    y: input.top,
    toJSON: () => input,
  } as DOMRect;
}
