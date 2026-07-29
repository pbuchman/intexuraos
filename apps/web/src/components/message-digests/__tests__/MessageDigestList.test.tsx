/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageDigestDefinition } from '@/types/messageDigests';
import { MessageDigestList, type MessageDigestListProps } from '../MessageDigestList.js';
import {
  getMessageDigestLifecycleDisabledReason,
  getMessageDigestRunDisabledReason,
} from '../messageDigestLifecycle.js';

describe('MessageDigestList', () => {
  afterEach(() => {
    cleanup();
  });

  it.each(['SOURCE_NOT_FOUND', 'SOURCE_UNAVAILABLE', 'SOURCE_CHANGED'])(
    'treats %s as a source identity blocker',
    (attentionCode) => {
      expect(
        getMessageDigestLifecycleDisabledReason(
          definition('source-blocked', {
            status: 'paused',
            listStatus: 'needs_attention',
            attentionCode,
          }),
          lifecycleContext()
        )
      ).toBe('Choose an available source before resuming this digest.');
    }
  );

  it('does not treat SOURCE_TOO_LARGE as a source identity blocker', () => {
    expect(
      getMessageDigestLifecycleDisabledReason(
        definition('recoverable-source-size', {
          status: 'paused',
          listStatus: 'needs_attention',
          attentionCode: 'SOURCE_TOO_LARGE',
          latestRun: failedLatestRun('recoverable-source-size'),
        }),
        lifecycleContext()
      )
    ).toBeNull();
  });

  it.each([
    [
      'source refresh',
      { sourceIsRefreshing: true },
      'Wait for the Private WhatsApp status check before running.',
    ],
    [
      'delivery load',
      { deliveryIsLoading: true },
      'Wait for WhatsApp delivery checks before running this digest.',
    ],
    [
      'delivery refresh',
      { deliveryIsRefreshing: true },
      'Wait for WhatsApp delivery checks before running this digest.',
    ],
  ])('fails Run closed during a retained-value %s', (_label, contextPatch, expected) => {
    expect(
      getMessageDigestRunDisabledReason(definition('refreshing-run-guard'), {
        ...lifecycleContext(),
        ...contextPatch,
      })
    ).toBe(expected);
  });

  it('renders a semantic desktop table, mobile cards, and independent 44px action menus', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onRun = vi.fn();
    renderList({
      items: [definition('digest-a'), definition('digest-b', { chatType: 'direct' })],
      onDelete,
      onRun,
    });

    const table = screen.getByRole('table', { name: 'Message Digests' });
    for (const heading of [
      'Name',
      'Conversation',
      'Schedule',
      'Status',
      'Last run',
      'Next run',
      'Actions',
    ]) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByTestId('message-digest-desktop-list')).toHaveClass('hidden', 'lg:block');
    expect(screen.getByTestId('message-digest-mobile-list')).toHaveClass('lg:hidden');

    const mobileCard = screen.getByTestId('message-digest-mobile-digest-a');
    expect(mobileCard).toHaveClass('min-w-0');
    const actionButton = within(mobileCard).getByRole('button', {
      name: 'Actions for Digest digest-a',
    });
    expect(actionButton).toHaveClass('min-h-11', 'min-w-11');
    await user.click(actionButton);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'View details' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a'
    );
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a/edit'
    );
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Run now' }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'digest-a' }));
    await user.click(actionButton);
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete digest' }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'digest-a' }));
  });

  it('shows an announced skeleton only during initial loading', () => {
    renderList({ isInitialLoading: true });

    expect(screen.getByRole('status', { name: 'Loading Message Digests' })).toBeInTheDocument();
    expect(screen.getAllByTestId('message-digest-skeleton')).toHaveLength(3);
    expect(screen.queryByText('No digests yet')).not.toBeInTheDocument();
  });

  it('keeps an initial error separate from empty state and offers retry', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderList({ error: 'Message Digests are unavailable', onRefresh });

    expect(screen.getByRole('alert')).toHaveTextContent('Message Digests are unavailable');
    expect(screen.queryByText('No digests yet')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('distinguishes first use from an empty filtered result', async () => {
    const user = userEvent.setup();
    const first = renderList();
    expect(screen.getByText('No digests yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Create a daily summary for a WhatsApp group or person/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your first digest' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/new'
    );
    first.unmount();

    const onClearFilters = vi.fn();
    renderList({ query: 'missing', onClearFilters });
    expect(screen.getByText('No digests match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('opens the exact owned detail from the name without opening the row action menu', () => {
    renderList({ items: [definition('digest-owned')] });

    for (const link of screen.getAllByRole('link', { name: 'Digest digest-owned' })) {
      expect(link).toHaveAttribute('href', '/whatsapp/message-digests/digest-owned');
    }
    for (const trigger of screen.getAllByRole('button', {
      name: 'Actions for Digest digest-owned',
    })) {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('retains rows during refresh and load-more failures with distinct live feedback', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn().mockResolvedValue(undefined);
    renderList({
      items: [definition('digest-a')],
      isRefreshing: true,
      refreshError: 'Refresh failed',
      loadMoreError: 'More results failed',
      nextCursor: 'next-page',
      onLoadMore,
    });

    expect(screen.getAllByText('Digest digest-a').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Refreshing Message Digests' })).toBeDisabled();
    expect(screen.getByTestId('message-digest-results')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed');
    expect(screen.getByRole('alert')).toHaveTextContent('More results failed');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows the template, immutable latest run, and truthful next-run state on table and cards', () => {
    renderList({
      items: [
        definition('active', {
          templateId: 'fishing_group',
          latestRun: {
            id: 'run-active',
            startedAt: '2026-07-27T05:30:00.000Z',
            generationStatus: 'completed',
            processingStage: 'completed',
            deliveryStatus: 'sent',
          },
        }),
        definition('paused', { status: 'paused', listStatus: 'paused' }),
        definition('delivery-setup', {
          listStatus: 'needs_attention',
          attentionCode: 'DELIVERY_SETUP_REQUIRED',
        }),
        definition('source-missing', {
          listStatus: 'needs_attention',
          attentionCode: 'SOURCE_NOT_FOUND',
        }),
        definition('deleting', { status: 'deleting', listStatus: 'paused' }),
      ],
    });

    const active = screen.getByTestId('message-digest-mobile-active');
    expect(active).toHaveTextContent('Fishing group summary');
    expect(active).toHaveTextContent('Jul 27, 2026, 7:30 AM');
    expect(active).toHaveTextContent('Completed');
    expect(active).toHaveTextContent('Jul 28, 2026, 7:30 AM');

    expect(screen.getByTestId('message-digest-mobile-paused')).toHaveTextContent('Paused');
    expect(screen.getByTestId('message-digest-mobile-delivery-setup')).toHaveTextContent(
      'Needs WhatsApp setup'
    );
    expect(screen.getByTestId('message-digest-mobile-source-missing')).toHaveTextContent(
      'Source unavailable'
    );
    expect(screen.getByTestId('message-digest-mobile-deleting')).toHaveTextContent(
      'Deletion in progress'
    );
    expect(screen.getByTestId('message-digest-mobile-paused')).toHaveTextContent('— No runs yet');
    expect(screen.getByTestId('message-digest-results')).toHaveAttribute('aria-busy', 'false');
  });

  it('renders every cadence truthfully instead of labelling all schedules daily', () => {
    renderList({
      items: [
        definition('daily'),
        definition('weekdays', {
          schedule: { kind: 'weekdays', localTime: '08:15', timeZone: 'Europe/Warsaw' },
        }),
        definition('weekly', {
          schedule: {
            kind: 'weekly',
            weekday: 'sunday',
            localTime: '19:45',
            timeZone: 'Europe/Warsaw',
          },
        }),
      ],
    });

    expect(screen.getByTestId('message-digest-mobile-daily')).toHaveTextContent('Daily at 07:30');
    expect(screen.getByTestId('message-digest-mobile-weekdays')).toHaveTextContent(
      'Weekdays at 08:15'
    );
    expect(screen.getByTestId('message-digest-mobile-weekly')).toHaveTextContent(
      'Every Sunday at 19:45'
    );
  });

  it('exposes sortable table headers with the current direction and atomic header intent', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const onDirectionChange = vi.fn();
    renderList({
      items: [definition('sortable')],
      sort: 'name',
      direction: 'asc',
      onSortChange,
      onDirectionChange,
    });

    const table = screen.getByRole('table', { name: 'Message Digests' });
    const nameHeader = within(table).getByRole('columnheader', { name: /Name/u });
    const nextRunHeader = within(table).getByRole('columnheader', { name: /Next run/u });
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(nextRunHeader).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('status', { name: 'Current sort' })).toHaveTextContent(
      'Sorted by Name, ascending'
    );

    await user.click(within(nameHeader).getByRole('button', { name: /Name/u }));
    expect(onDirectionChange).toHaveBeenCalledWith('desc');
    await user.click(within(nextRunHeader).getByRole('button', { name: /Next run/u }));
    expect(onSortChange).toHaveBeenCalledWith('nextRunAt');

    const nameSort = within(nameHeader).getByRole('button', { name: /Name/u });
    nameSort.focus();
    await user.keyboard('{Enter}');
    expect(onDirectionChange).toHaveBeenLastCalledWith('desc');
  });

  it('locks only the pending row and keeps a failed lifecycle mutation visible without optimistic state', async () => {
    const user = userEvent.setup();
    const onToggleLifecycle = vi.fn();
    renderList({
      items: [
        definition('active'),
        definition('paused', { status: 'paused', listStatus: 'paused' }),
      ],
      lifecyclePending: { active: 'pause' },
      lifecycleErrors: { paused: 'This digest changed elsewhere. Refresh and try again.' },
      onToggleLifecycle,
    });

    expect(
      within(screen.getByTestId('message-digest-mobile-active')).getByRole('button', {
        name: 'Pausing Digest active…',
      })
    ).toBeDisabled();
    const pausedCard = screen.getByTestId('message-digest-mobile-paused');
    const pausedTrigger = within(pausedCard).getByRole('button', {
      name: 'Actions for Digest paused',
    });
    expect(pausedTrigger).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Digest paused was not changed');
    expect(pausedCard).toHaveTextContent('Paused');

    await user.click(pausedTrigger);
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Resume digest' }));
    expect(onToggleLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'paused', revision: 1, status: 'paused' }),
      'pointer'
    );
  });

  it('explains needs-attention and source-unavailable states and disables unsafe actions', async () => {
    const user = userEvent.setup();
    renderList({
      items: [
        definition('delivery-setup', {
          listStatus: 'needs_attention',
          attentionCode: 'DELIVERY_SETUP_REQUIRED',
        }),
        definition('source-missing', {
          listStatus: 'needs_attention',
          attentionCode: 'SOURCE_NOT_FOUND',
        }),
      ],
    });

    expect(screen.getAllByText('WhatsApp delivery setup required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Source conversation needs attention').length).toBeGreaterThan(0);

    const card = screen.getByTestId('message-digest-mobile-source-missing');
    await user.click(
      within(card).getByRole('button', { name: 'Actions for Digest source-missing' })
    );
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Run now' })).toBeDisabled();
    expect(
      within(screen.getByRole('menu')).getByText('Choose an available source before running this digest.')
    ).toBeVisible();
  });

  it('disables Run now for a paused definition before invoking any mutation', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    renderList({
      items: [definition('paused', { status: 'paused', listStatus: 'paused' })],
      onRun,
    });

    const card = screen.getByTestId('message-digest-mobile-paused');
    await user.click(within(card).getByRole('button', { name: 'Actions for Digest paused' }));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Run now' })).toBeDisabled();
    expect(within(screen.getByRole('menu')).getByText('Resume this digest before running it.')).toBeVisible();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('fences every other digest while one confirmed run still needs recovery', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    renderList({
      items: [definition('digest-a'), definition('digest-b')],
      pendingRunRecoveryDefinitionId: 'digest-a',
      onRun,
    });

    expect(screen.getByRole('link', { name: 'Recover pending run' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a'
    );

    const blockedCard = screen.getByTestId('message-digest-mobile-digest-b');
    await user.click(
      within(blockedCard).getByRole('button', { name: 'Actions for Digest digest-b' })
    );
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Run now' })).toBeDisabled();
    expect(
      within(screen.getByRole('menu')).getByText(
        'Recover the pending Message Digest run before starting another.'
      )
    ).toBeVisible();
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete digest' })).toBeEnabled();
    expect(onRun).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');

    const recoveryCard = screen.getByTestId('message-digest-mobile-digest-a');
    await user.click(
      within(recoveryCard).getByRole('button', { name: 'Actions for Digest digest-a' })
    );
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete digest' })).toBeDisabled();
    expect(
      within(screen.getByRole('menu')).getByText(
        'Recover the pending Message Digest run before deleting this digest.'
      )
    ).toBeVisible();
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Run now' }));
    expect(onRun).toHaveBeenCalledOnce();
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'digest-a' }));
  });

  it.each([
    {
      label: 'active generation work',
      item: definition('resume-running', {
        status: 'paused',
        listStatus: 'paused',
        latestRun: {
          id: 'run-resume-running',
          startedAt: '2026-07-27T12:00:00.000Z',
          generationStatus: 'processing',
          processingStage: 'aggregating',
          deliveryStatus: 'not_sent',
        },
      }),
      props: {},
      reason: 'Wait for the current digest run to finish before resuming.',
    },
    {
      label: 'missing source mirror',
      item: definition('resume-source-missing', { status: 'paused', listStatus: 'paused' }),
      props: { sourceAvailability: 'missing' },
      reason: 'Connect Private WhatsApp before resuming this digest.',
    },
    {
      label: 'unavailable source status',
      item: definition('resume-source-unavailable', { status: 'paused', listStatus: 'paused' }),
      props: { sourceAvailability: 'unavailable' },
      reason: 'Retry the Private WhatsApp status check before resuming.',
    },
    {
      label: 'source-specific attention',
      item: definition('resume-source-attention', {
        status: 'paused',
        listStatus: 'needs_attention',
        attentionCode: 'SOURCE_CHANGED',
      }),
      props: {},
      reason: 'Choose an available source before resuming this digest.',
    },
    {
      label: 'unavailable delivery status',
      item: definition('resume-delivery-unavailable', { status: 'paused', listStatus: 'paused' }),
      props: { deliveryReadinessError: 'Status unavailable' },
      reason: 'Retry WhatsApp delivery checks before resuming this digest.',
    },
    {
      label: 'missing delivery mapping',
      item: definition('resume-mapping-missing', { status: 'paused', listStatus: 'paused' }),
      props: {
        deliveryReadiness: {
          status: 'mapping_missing',
          observationVersion: 'mapping-v1',
          observedAt: '2026-07-27T12:00:00.000Z',
        },
      },
      reason: 'Map a primary WhatsApp number before resuming this digest.',
    },
    {
      label: 'disconnected delivery',
      item: definition('resume-delivery-disconnected', { status: 'paused', listStatus: 'paused' }),
      props: {
        deliveryReadiness: {
          status: 'disconnected',
          observationVersion: 'mapping-v1',
          observedAt: '2026-07-27T12:00:00.000Z',
        },
      },
      reason: 'Reconnect WhatsApp delivery before resuming this digest.',
    },
    {
      label: 'disabled delivery',
      item: definition('resume-delivery-disabled', { status: 'paused', listStatus: 'paused' }),
      props: {
        deliveryReadiness: {
          status: 'delivery_disabled',
          observationVersion: 'mapping-v1',
          observedAt: '2026-07-27T12:00:00.000Z',
        },
      },
      reason: 'Enable WhatsApp delivery before resuming this digest.',
    },
  ] as const)('blocks Resume for $label on desktop and mobile', async ({ item, props, reason }) => {
    const user = userEvent.setup();
    renderList({ items: [item], ...props });

    const table = screen.getByRole('table', { name: 'Message Digests' });
    await user.click(
      within(table).getByRole('button', { name: `Actions for ${item.name}` })
    );
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Resume digest' })).toBeDisabled();
    expect(within(screen.getByRole('menu')).getByText(reason)).toBeVisible();
    await user.keyboard('{Escape}');

    const card = screen.getByTestId(`message-digest-mobile-${item.id}`);
    await user.click(
      within(card).getByRole('button', { name: `Actions for ${item.name}` })
    );
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Resume digest' })).toBeDisabled();
    expect(within(screen.getByRole('menu')).getByText(reason)).toBeVisible();
  });

  it('re-enables Resume when a delivery setup blocker is now ready', async () => {
    const user = userEvent.setup();
    const onToggleLifecycle = vi.fn();
    const item = definition('resume-delivery-ready', {
      status: 'paused',
      listStatus: 'needs_attention',
      attentionCode: 'DELIVERY_SETUP_REQUIRED',
    });
    renderList({ items: [item], onToggleLifecycle });

    const table = screen.getByRole('table', { name: 'Message Digests' });
    await user.click(
      within(table).getByRole('button', { name: `Actions for ${item.name}` })
    );
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Resume digest' })).toBeEnabled();
    await user.keyboard('{Escape}');

    const card = screen.getByTestId(`message-digest-mobile-${item.id}`);
    await user.click(
      within(card).getByRole('button', { name: `Actions for ${item.name}` })
    );
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Resume digest' }));
    expect(onToggleLifecycle).toHaveBeenCalledWith(item, 'pointer');
  });

  it('enables SOURCE_TOO_LARGE recovery on desktop and mobile and invokes one Resume action', async () => {
    const user = userEvent.setup();
    const onToggleLifecycle = vi.fn();
    const item = definition('resume-source-too-large', {
      status: 'paused',
      listStatus: 'needs_attention',
      attentionCode: 'SOURCE_TOO_LARGE',
      latestRun: failedLatestRun('resume-source-too-large'),
    });
    renderList({ items: [item], onToggleLifecycle });

    expect(screen.queryByText('Source conversation needs attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Source unavailable')).not.toBeInTheDocument();
    expect(screen.getAllByText('Run window is too large. Resume to retry it.').length).toBeGreaterThan(
      0
    );
    expect(screen.getAllByText('Resume to retry window').length).toBeGreaterThan(0);

    const table = screen.getByRole('table', { name: 'Message Digests' });
    await user.click(within(table).getByRole('button', { name: `Actions for ${item.name}` }));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Resume digest' })).toBeEnabled();
    await user.keyboard('{Escape}');

    const card = screen.getByTestId(`message-digest-mobile-${item.id}`);
    await user.click(within(card).getByRole('button', { name: `Actions for ${item.name}` }));
    const resume = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Resume digest' });
    expect(resume).toBeEnabled();
    await user.click(resume);
    expect(onToggleLifecycle).toHaveBeenCalledOnce();
    expect(onToggleLifecycle).toHaveBeenCalledWith(item, 'pointer');
  });

  it('keeps Run available for an active SOURCE_TOO_LARGE recovery with healthy current checks', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const item = definition('run-source-too-large', {
      status: 'active',
      listStatus: 'needs_attention',
      attentionCode: 'SOURCE_TOO_LARGE',
      latestRun: failedLatestRun('run-source-too-large'),
    });
    renderList({ items: [item], onRun });

    expect(
      screen.getAllByText('Run window is too large. Run now to retry it.').length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Run now to retry window').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Resume to retry (it|window)/i)).not.toBeInTheDocument();

    const card = screen.getByTestId(`message-digest-mobile-${item.id}`);
    await user.click(within(card).getByRole('button', { name: `Actions for ${item.name}` }));
    const runNow = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Run now' });
    expect(runNow).toBeEnabled();
    await user.click(runNow);
    expect(onRun).toHaveBeenCalledOnce();
    expect(onRun).toHaveBeenCalledWith(item);
  });

  it('blocks Run from current source availability even when the list projection is active', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const item = definition('run-current-source-unavailable');
    renderList({ items: [item], sourceAvailability: 'unavailable', onRun });

    const card = screen.getByTestId(`message-digest-mobile-${item.id}`);
    await user.click(within(card).getByRole('button', { name: `Actions for ${item.name}` }));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Run now' })).toBeDisabled();
    expect(within(screen.getByRole('menu')).getByText('Retry the Private WhatsApp status check before running.')).toBeVisible();
    expect(onRun).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', 'Connect Private WhatsApp Mirror'],
    ['unavailable', 'Private WhatsApp Mirror status unavailable'],
  ] as const)('shows source setup state %s', (sourceAvailability, expectedHeading) => {
    renderList({ sourceAvailability });
    expect(screen.getByRole('heading', { name: expectedHeading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open WhatsApp settings' })).toHaveAttribute(
      'href',
      '/settings/whatsapp'
    );
  });

  it.each([
    ['mapping_missing', 'No primary WhatsApp number is mapped'],
    ['disconnected', 'WhatsApp delivery is disconnected'],
    ['delivery_disabled', 'WhatsApp delivery is disabled'],
  ] as const)('shows delivery readiness %s without exposing a full number', (status, copy) => {
    renderList({
      deliveryReadiness: {
        status,
        observationVersion: 'mapping-v1',
        observedAt: '2026-07-27T12:00:00.000Z',
      },
    });
    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\+?\d{8,}/u);
  });

  it('emits accessible search, status, source, sort, direction, and clear-filter changes', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const onStatusChange = vi.fn();
    const onChatTypeChange = vi.fn();
    const onSortChange = vi.fn();
    const onDirectionChange = vi.fn();
    const onClearFilters = vi.fn();
    renderList({
      query: 'fish',
      status: 'paused',
      chatType: 'group',
      sort: 'name',
      direction: 'asc',
      onQueryChange,
      onStatusChange,
      onChatTypeChange,
      onSortChange,
      onDirectionChange,
      onClearFilters,
    });

    expect(screen.getByRole('status')).toHaveTextContent('Search results are sorted by name');
    await user.clear(screen.getByRole('searchbox', { name: 'Search digests' }));
    expect(onQueryChange).toHaveBeenLastCalledWith('');
    await user.click(screen.getByRole('button', { name: 'Active' }));
    expect(onStatusChange).toHaveBeenCalledWith('active');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Conversation type' }), 'direct');
    expect(onChatTypeChange).toHaveBeenCalledWith('direct');
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sort descending' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(onSortChange).not.toHaveBeenCalled();
    expect(onDirectionChange).not.toHaveBeenCalled();
  });
});

function renderList(overrides: Partial<MessageDigestListProps> = {}): ReturnType<typeof render> {
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
    onRun: vi.fn(),
    onDelete: vi.fn(),
    lifecyclePending: {},
    lifecycleErrors: {},
    lifecycleRefreshRequired: {},
    onToggleLifecycle: vi.fn(),
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <MessageDigestList {...props} />
    </MemoryRouter>
  );
}

function lifecycleContext(): Parameters<typeof getMessageDigestLifecycleDisabledReason>[1] {
  return {
    sourceAvailability: 'active',
    sourceIsRefreshing: false,
    sourceAvailabilityError: null,
    deliveryReadiness: {
      status: 'ready',
      observationVersion: 'mapping-v1',
      observedAt: '2026-07-27T12:00:00.000Z',
    },
    deliveryIsLoading: false,
    deliveryIsRefreshing: false,
    deliveryReadinessError: null,
  };
}

function failedLatestRun(id: string): NonNullable<MessageDigestDefinition['latestRun']> {
  return {
    id: `run-${id}`,
    startedAt: '2026-07-27T12:00:00.000Z',
    generationStatus: 'failed',
    processingStage: 'failed',
    deliveryStatus: 'not_sent',
  };
}

function definition(
  id: string,
  overrides: {
    chatType?: 'group' | 'direct';
    status?: MessageDigestDefinition['status'];
    listStatus?: 'active' | 'paused' | 'needs_attention';
    attentionCode?: string | null;
    templateId?: MessageDigestDefinition['instructions']['templateId'];
    latestRun?: MessageDigestDefinition['latestRun'];
    schedule?: MessageDigestDefinition['schedule'];
  } = {}
): MessageDigestDefinition {
  const listStatus = overrides.listStatus ?? 'active';
  return {
    id,
    name: `Digest ${id}`,
    status: overrides.status ?? (listStatus === 'needs_attention' ? 'active' : listStatus),
    listStatus,
    attentionCode: overrides.attentionCode ?? null,
    revision: 1,
    sourceLocked: false,
    source: {
      chatId: `chat-${id}`,
      chatType: overrides.chatType ?? 'group',
      displayName: overrides.chatType === 'direct' ? 'One person' : 'Fishing group',
    },
    instructions: {
      templateId: overrides.templateId ?? 'custom',
      text: 'Summarize the conversation using only relevant and supported facts.',
    },
    schedule: overrides.schedule ?? {
      kind: 'daily',
      localTime: '07:30',
      timeZone: 'Europe/Warsaw',
    },
    delivery: { type: 'whatsapp_primary' },
    checkpointAt: '2026-07-27T05:30:00.000Z',
    nextRunAt: '2026-07-28T05:30:00.000Z',
    lastRunAt: null,
    latestRun: overrides.latestRun ?? null,
    createdAt: '2026-07-27T12:00:00.000Z',
    updatedAt: '2026-07-27T12:00:00.000Z',
  };
}
