/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageDigestDeliveryPath } from '@/components/message-digests/MessageDigestDeliveryPath';
import {
  MessageDigestList,
  type MessageDigestListProps,
} from '@/components/message-digests/MessageDigestList';
import { MessageDigestRunStatus } from '@/components/message-digests/MessageDigestRunStatus';
import type { MessageDigestDefinition, MessageDigestRun } from '@/types/messageDigests';

describe('Message Digest responsive contracts', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.fontSize = '';
    document.documentElement.classList.remove('dark');
  });

  it('uses semantic desktop table and mobile cards without nested controls or sub-44px actions', async () => {
    const user = userEvent.setup();
    setViewport(390, 844);
    renderList({ items: [definition()] });

    expect(screen.getByRole('table', { name: 'Message Digests' }).querySelector('caption')).toHaveTextContent(
      'Message Digest definitions'
    );
    expect(screen.getByTestId('message-digest-desktop-list')).toHaveClass('hidden', 'lg:block');
    expect(screen.getByTestId('message-digest-mobile-list')).toHaveClass('lg:hidden', 'min-w-0');
    const card = screen.getByTestId('message-digest-mobile-digest-a');
    expect(card).toHaveClass('min-w-0');
    expect(card.querySelector('a a, a button, button a, button button')).toBeNull();
    expect(
      within(card).getByRole('link', { name: 'A very long digest name that must wrap safely' })
    ).toHaveClass('min-h-11', 'break-words');

    await user.click(within(card).getByRole('button', { name: /Actions for/ }));
    const menu = screen.getByRole('menu');
    for (const action of within(menu).getAllByRole('menuitem')) {
      expect(action).toHaveClass('min-h-11');
    }
  });

  it.each([
    [1280, 800],
    [1440, 900],
  ])(
    'keeps the semantic desktop layout, wrapping, and dark treatment at %d×%d',
    (width, height) => {
      setViewport(width, height);
      document.documentElement.classList.add('dark');
      const longDefinition = definition();
      longDefinition.schedule = {
        kind: 'weekly',
        weekday: 'wednesday',
        localTime: '23:45',
        timeZone: 'America/Argentina/ComodRivadavia',
      };
      renderList({ items: [longDefinition], sort: 'name', direction: 'asc' });

      expect(window.innerWidth).toBe(width);
      expect(window.innerHeight).toBe(height);
      const desktop = screen.getByTestId('message-digest-desktop-list');
      const table = within(desktop).getByRole('table', { name: 'Message Digests' });
      expect(desktop).toHaveClass('lg:block', 'dark:bg-slate-900');
      expect(within(table).getByRole('columnheader', { name: /Name/u })).toHaveAttribute(
        'aria-sort',
        'ascending'
      );
      for (const link of screen.getAllByRole('link', {
        name: 'A very long digest name that must wrap safely',
      })) {
        expect(link).toHaveClass('break-words', 'min-h-11');
      }
      for (const zone of screen.getAllByText('America/Argentina/ComodRivadavia')) {
        expect(zone).toHaveClass('break-words');
      }
      expect(screen.getByTestId('message-digest-mobile-digest-a')).toHaveClass(
        'min-w-0',
        'dark:bg-slate-900'
      );
    }
  );

  it('keeps a logical keyboard order with visible focus treatment', async () => {
    const user = userEvent.setup();
    setViewport(390, 844);
    renderList({ items: [definition()] });

    await user.tab();
    expect(screen.getByRole('button', { name: 'Refresh Message Digests' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Refresh Message Digests' })).toHaveClass(
      'focus:ring-2'
    );
    await user.tab();
    expect(screen.getByRole('link', { name: 'New digest' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('searchbox', { name: 'Search digests' })).toHaveFocus();
    expect(screen.getByRole('searchbox', { name: 'Search digests' })).toHaveClass(
      'focus:ring-2'
    );
  });

  it('stacks the delivery path on mobile and keeps every node shrink-safe at 200% zoom', () => {
    setViewport(390, 844);
    document.documentElement.style.fontSize = '200%';
    render(
      <MemoryRouter>
        <MessageDigestDeliveryPath
          source={{
            chatId: 'chat-a',
            chatType: 'direct',
            displayName: 'A long conversation name that must wrap without horizontal scrolling',
          }}
          readiness={{
            status: 'ready',
            maskedPrimaryNumber: '•••• 1234',
            observationVersion: 'mapping-v1',
            observedAt: '2026-07-27T12:00:00.000Z',
          }}
          isLoading={false}
          error={null}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    );

    const section = screen
      .getByRole('heading', { name: 'From conversation to WhatsApp' })
      .closest('section');
    expect(section).not.toBeNull();
    expect(section?.querySelectorAll('.min-w-0').length).toBeGreaterThanOrEqual(4);
    const arrows = section?.querySelectorAll('svg.rotate-90.md\\:rotate-0');
    expect(arrows?.length).toBe(2);
    expect(section?.className).not.toMatch(/\bh-\[/u);
  });

  it('honors reduced motion for loading, polling, and skeleton indicators', () => {
    const first = renderList({ items: [], isInitialLoading: true, isRefreshing: true });
    const skeleton = screen.getAllByTestId('message-digest-skeleton')[0];
    expect(skeleton).toHaveClass('animate-pulse', 'motion-reduce:animate-none');
    const refreshIcon = screen
      .getByRole('button', { name: 'Refreshing Message Digests' })
      .querySelector('svg');
    expect(refreshIcon).toHaveClass('animate-spin', 'motion-reduce:animate-none');
    first.unmount();

    render(<MessageDigestRunStatus run={activeRun()} />);
    const progressIcon = screen.getByTestId('generation-status').querySelector('svg');
    expect(progressIcon).toHaveClass('animate-spin', 'motion-reduce:animate-none');
  });
});

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

function renderList(overrides: Partial<MessageDigestListProps>): ReturnType<typeof render> {
  const props: MessageDigestListProps = {
    items: [],
    nextCursor: null,
    isInitialLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    error: null,
    refreshError: null,
    loadMoreError: null,
    query: '',
    status: undefined,
    chatType: undefined,
    sort: 'updatedAt',
    direction: 'desc',
    sourceAvailability: 'active',
    sourceIsRefreshing: false,
    sourceAvailabilityError: null,
    deliveryReadiness: {
      status: 'ready',
      maskedPrimaryNumber: '•••• 1234',
      observationVersion: 'mapping-v1',
      observedAt: '2026-07-27T12:00:00.000Z',
    },
    deliveryIsLoading: false,
    deliveryIsRefreshing: false,
    deliveryReadinessError: null,
    pendingRunRecoveryDefinitionId: null,
    onQueryChange: vi.fn(),
    onStatusChange: vi.fn(),
    onChatTypeChange: vi.fn(),
    onSortChange: vi.fn(),
    onDirectionChange: vi.fn(),
    onClearFilters: vi.fn(),
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onRetrySetup: vi.fn().mockResolvedValue(undefined),
    onLoadMore: vi.fn().mockResolvedValue(undefined),
    lifecyclePending: {},
    lifecycleErrors: {},
    lifecycleRefreshRequired: {},
    onToggleLifecycle: vi.fn(),
    onRun: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <MessageDigestList {...props} />
    </MemoryRouter>
  );
}

function definition(): MessageDigestDefinition {
  return {
    id: 'digest-a',
    name: 'A very long digest name that must wrap safely',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 1,
    sourceLocked: false,
    source: { chatId: 'chat-a', chatType: 'group', displayName: 'Fishing group' },
    instructions: { templateId: 'custom', text: 'Summarize supported important facts.' },
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

function activeRun(): MessageDigestRun {
  return {
    id: 'run-a',
    definitionId: 'digest-a',
    trigger: 'manual',
    window: {
      start: '2026-07-26T05:30:00.000Z',
      end: '2026-07-27T05:30:00.000Z',
      scheduledBoundary: '2026-07-27T05:30:00.000Z',
    },
    generationStatus: 'processing',
    processingStage: 'aggregating',
    attempts: 1,
    source: { chatType: 'group', displayName: 'Fishing group' },
    instructions: { templateId: 'custom', text: 'Summarize supported facts.', revision: 'v1' },
    schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
    content: null,
    effectiveMessageCount: null,
    promptVersion: null,
    model: null,
    usage: null,
    delivery: {
      type: 'whatsapp_primary',
      status: 'not_sent',
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T05:30:00.000Z',
    updatedAt: '2026-07-27T05:30:00.000Z',
    completedAt: null,
  };
}
