/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LlmModels } from '@intexuraos/llm-contract';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  UseMessageDigestCommandsResult,
  UseMessageDigestDefinitionResult,
  UseMessageDigestDeletionResult,
  UseMessageDigestDeliveryReadinessResult,
  UseMessageDigestHistoryResult,
  UseMessageDigestRunResult,
  UseMessageDigestSourceAvailabilityResult,
} from '@/hooks/useMessageDigests';
import type {
  MessageDigestDefinition,
  MessageDigestRun,
  MessageDigestRunPreparation,
} from '@/types/messageDigests';

const mocks = vi.hoisted(() => ({
  useMessageDigestDefinition: vi.fn(),
  useMessageDigestDeliveryReadiness: vi.fn(),
  useMessageDigestHistory: vi.fn(),
  useMessageDigestSourceAvailability: vi.fn(),
  useMessageDigestCommands: vi.fn(),
  useMessageDigestRun: vi.fn(),
  useMessageDigestDeletion: vi.fn(),
  definitionRefresh: vi.fn(),
  readinessRefresh: vi.fn(),
  sourceRefresh: vi.fn(),
  definitionAdopt: vi.fn(),
  definitionRefreshWithResult: vi.fn(),
  historyRefresh: vi.fn(),
  historyLoadMore: vi.fn(),
  prepareRun: vi.fn(),
  confirmRun: vi.fn(),
  recoverPendingRun: vi.fn(),
  finishRunRequest: vi.fn(),
  clearError: vi.fn(),
  updateDigest: vi.fn(),
  startDeletion: vi.fn(),
  retryDeletion: vi.fn(),
  copyText: vi.fn(),
}));

vi.mock('@/hooks/useMessageDigests', () => ({
  useMessageDigestDefinition: (definitionId: string): UseMessageDigestDefinitionResult =>
    mocks.useMessageDigestDefinition(definitionId),
  useMessageDigestDeliveryReadiness: (): UseMessageDigestDeliveryReadinessResult =>
    mocks.useMessageDigestDeliveryReadiness(),
  useMessageDigestSourceAvailability: (): UseMessageDigestSourceAvailabilityResult =>
    mocks.useMessageDigestSourceAvailability(),
  useMessageDigestHistory: (
    definitionId: string,
    options: unknown
  ): UseMessageDigestHistoryResult => mocks.useMessageDigestHistory(definitionId, options),
  useMessageDigestCommands: (): UseMessageDigestCommandsResult => mocks.useMessageDigestCommands(),
  useMessageDigestRun: (definitionId: string, runId: string): UseMessageDigestRunResult =>
    mocks.useMessageDigestRun(definitionId, runId),
  useMessageDigestDeletion: (
    definitionId: string,
    options?: { erasureRequestId?: string | null }
  ): UseMessageDigestDeletionResult => mocks.useMessageDigestDeletion(definitionId, options),
}));

vi.mock('@/components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <main>{children}</main>
  ),
}));

import { WhatsAppMessageDigestDetailPage } from '../WhatsAppMessageDigestDetailPage.js';

describe('WhatsAppMessageDigestDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.definitionRefresh.mockResolvedValue(undefined);
    mocks.definitionRefreshWithResult.mockResolvedValue(true);
    mocks.readinessRefresh.mockResolvedValue(undefined);
    mocks.sourceRefresh.mockResolvedValue(undefined);
    mocks.historyRefresh.mockResolvedValue(undefined);
    mocks.historyLoadMore.mockResolvedValue(undefined);
    mocks.prepareRun.mockResolvedValue(preparation());
    mocks.confirmRun.mockResolvedValue({
      disposition: 'reserved',
      dispatchDisposition: 'published',
      run: run('run-latest'),
    });
    mocks.recoverPendingRun.mockResolvedValue({
      disposition: 'existing',
      dispatchDisposition: 'not_requested',
      run: run('run-recovered'),
    });
    mocks.updateDigest.mockResolvedValue({
      ...definition(),
      status: 'paused',
      listStatus: 'paused',
      revision: 8,
    });
    mocks.startDeletion.mockResolvedValue(null);
    mocks.retryDeletion.mockResolvedValue(null);
    mocks.copyText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.copyText },
    });
    mocks.useMessageDigestDefinition.mockReturnValue(definitionResult());
    mocks.useMessageDigestDeliveryReadiness.mockReturnValue(readinessResult());
    mocks.useMessageDigestSourceAvailability.mockReturnValue(sourceResult());
    mocks.useMessageDigestHistory.mockReturnValue(historyResult());
    mocks.useMessageDigestCommands.mockReturnValue(commandsResult());
    mocks.useMessageDigestRun.mockReturnValue(runResult());
    mocks.useMessageDigestDeletion.mockReturnValue(deletionResult());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.documentElement.style.fontSize = '';
  });

  it('shows the delivery path, exact configuration, readiness, latest run, and recent history', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderDetail({ state: { created: true } });

    expect(screen.getByRole('heading', { name: 'Daily fishing brief' })).toHaveFocus();
    expect(screen.getByText('Fishing group')).toBeInTheDocument();
    expect(screen.getByText('Private WhatsApp Mirror')).toBeInTheDocument();
    expect(screen.getByText('Message Digest Service')).toBeInTheDocument();
    expect(screen.getByText('•••• 1234')).toBeInTheDocument();
    expect(screen.getByText('Daily at 07:30')).toBeInTheDocument();
    expect(screen.getAllByText('Europe/Warsaw').length).toBeGreaterThan(0);
    expect(screen.getByText(definition().instructions.text)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit digest' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a/edit'
    );
    expect(screen.getByRole('link', { name: 'Open WhatsApp settings' })).toHaveAttribute(
      'href',
      '/settings/whatsapp'
    );
    expect(screen.getByRole('link', { name: 'View full history' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a/history'
    );
    expect(screen.getByRole('link', { name: 'View latest result' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a/history/run-latest'
    );
    expect(screen.getByTestId('generation-status')).toHaveTextContent('Completed');
    expect(screen.getByTestId('delivery-status')).toHaveTextContent('Sent');
    expect(mocks.useMessageDigestHistory).toHaveBeenCalledWith('digest-a', {
      limit: 5,
      sort: 'windowStart',
      direction: 'desc',
    });

    await user.click(screen.getByRole('button', { name: 'Copy instructions' }));
    expect(writeText).toHaveBeenCalledWith(definition().instructions.text);
    expect(
      await screen.findByRole('status', { name: 'Copy instructions result' })
    ).toHaveTextContent('Instructions copied');
  });

  it('moves focus to the detail heading after create navigation finishes loading', async () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({ definition: null, isLoading: true })
    );
    const view = renderDetail({ state: { created: true } });

    expect(screen.queryByRole('heading', { name: 'Daily fishing brief' })).not.toBeInTheDocument();

    mocks.useMessageDigestDefinition.mockReturnValue(definitionResult());
    view.rerender(<DetailTestRouter state={{ created: true }} />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Daily fishing brief' })).toHaveFocus()
    );
  });

  it('focuses a routed detail heading once without stealing focus after definition adoption', async () => {
    const view = renderDetail({ state: { created: true } });
    const heading = screen.getByRole('heading', { name: 'Daily fishing brief' });
    expect(heading).toHaveFocus();

    const runAction = screen.getByRole('button', { name: 'Run now' });
    runAction.focus();
    expect(runAction).toHaveFocus();

    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({ definition: { ...definition(), revision: 9 } })
    );
    view.rerender(<DetailTestRouter state={{ created: true }} />);

    expect(screen.getByRole('button', { name: 'Run now' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Daily fishing brief' })).not.toHaveFocus();
  });

  it('waits for the definition matching a new route before handling routed focus', async () => {
    const user = userEvent.setup();
    let routedDefinition = definition();
    mocks.useMessageDigestDefinition.mockImplementation(() =>
      definitionResult({ definition: routedDefinition })
    );
    const view = renderDetail({ withRouteSwitcher: true });

    await user.click(screen.getByRole('button', { name: 'Open second digest' }));

    expect(mocks.useMessageDigestDefinition).toHaveBeenLastCalledWith('digest-b');
    expect(screen.getByRole('heading', { name: 'Daily fishing brief' })).not.toHaveFocus();

    routedDefinition = {
      ...definition(),
      id: 'digest-b',
      name: 'Direct sentiment brief',
    };
    view.rerender(<DetailTestRouter withRouteSwitcher />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Direct sentiment brief' })).toHaveFocus()
    );
  });

  it('shows the activation adjustment only for the exact delivery setup reason', () => {
    const rendered = renderDetail({
      state: { activationAdjusted: 'delivery_setup_required' },
    });

    expect(
      screen.getByText(
        'The digest was saved as paused because primary WhatsApp delivery is not ready yet.'
      )
    ).toBeInTheDocument();

    rendered.unmount();
    renderDetail({ state: { activationAdjusted: true } });

    expect(
      screen.queryByText(
        'The digest was saved as paused because primary WhatsApp delivery is not ready yet.'
      )
    ).not.toBeInTheDocument();
  });

  it('copies only visible instructions and announces clipboard failure', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('Clipboard denied'));
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Copy instructions' }));
    expect(
      await screen.findByRole('status', { name: 'Copy instructions result' })
    ).toHaveTextContent('Couldn’t copy instructions');
    expect(writeText).toHaveBeenCalledWith(definition().instructions.text);
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain('chat-fishing');
  });

  it('formats latest and recent runs in each immutable run schedule zone', () => {
    const latest = {
      ...run('run-latest'),
      schedule: { kind: 'daily' as const, localTime: '01:30', timeZone: 'America/New_York' },
    };
    const previous = {
      ...run('run-previous'),
      schedule: { kind: 'daily' as const, localTime: '14:30', timeZone: 'Asia/Tokyo' },
    };
    mocks.useMessageDigestHistory.mockReturnValue(
      historyResult({ items: [latest, previous] })
    );
    mocks.useMessageDigestRun.mockReturnValue(runResult({ run: latest }));

    renderDetail();

    expect(screen.getAllByText('Jul 27, 2026, 1:30 AM').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Jul 27, 2026, 2:30 PM')).toBeInTheDocument();
    expect(screen.queryByText('Jul 27, 2026, 7:30 AM')).not.toBeInTheDocument();
  });

  it('prepares the server window before confirmation and starts one canonical run', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Run now' }));
    expect(mocks.prepareRun).toHaveBeenCalledWith('digest-a');
    const dialog = screen.getByRole('dialog', { name: 'Run and send this digest?' });
    expect(dialog).toHaveTextContent('Jul 26, 2026');
    expect(dialog).toHaveTextContent('Jul 27, 2026');
    expect(dialog).toHaveTextContent('Europe/Warsaw');
    expect(dialog).toHaveTextContent('•••• 1234');
    expect(dialog).toHaveTextContent(/generates, saves, and sends/i);

    await user.click(screen.getByRole('button', { name: 'Run and send' }));
    await waitFor(() => expect(mocks.confirmRun).toHaveBeenCalledWith('digest-a'));
    expect(mocks.finishRunRequest).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests/digest-a/history/run-latest'
    );
    expect(screen.getByTestId('location-probe')).toHaveTextContent('"focusHeading":true');
  });

  it('returns focus to Run now when the confirmation dialog is cancelled', async () => {
    const user = userEvent.setup();
    renderDetail();
    const runNow = screen.getByRole('button', { name: 'Run now' });

    await user.click(runNow);
    expect(screen.getByRole('dialog', { name: 'Run and send this digest?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(runNow).toHaveFocus();
  });

  it('keeps the Run confirmation controls reachable at 200% zoom and short viewport height', async () => {
    const user = userEvent.setup();
    document.documentElement.style.fontSize = '200%';
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 });
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Run now' }));

    const dialog = screen.getByRole('dialog', { name: 'Run and send this digest?' });
    expect(dialog).toHaveClass(
      'max-h-[calc(100dvh-2rem)]',
      'overflow-y-auto',
      'overscroll-contain'
    );
    expect(dialog).toHaveClass('w-[calc(100%-2rem)]');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Run and send' })).toBeVisible();
  });

  it('carries explicit heading focus intent into full history', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole('link', { name: 'View full history' }));

    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests/digest-a/history'
    );
    expect(screen.getByTestId('location-probe')).toHaveTextContent('"focusHeading":true');
  });

  it('keeps a stale preparation unsent and requires confirmation of the refreshed window', async () => {
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({
        error: 'The run window changed. Review the updated window and confirm again.',
        requiresRunReconfirmation: true,
      })
    );
    renderDetail({ state: { openRun: true } });

    expect(
      await screen.findByRole('dialog', { name: 'Run and send this digest?' })
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The run window changed');
    expect(screen.getByRole('button', { name: 'Confirm updated window' })).toBeInTheDocument();
    expect(mocks.confirmRun).not.toHaveBeenCalled();
  });

  it('recovers a confirmed run after reload without preparing a second window', async () => {
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({ pendingRunRecoveryDefinitionId: 'digest-a' })
    );

    renderDetail({ state: { openRun: true } });

    await waitFor(() => expect(mocks.recoverPendingRun).toHaveBeenCalledWith('digest-a'));
    expect(mocks.prepareRun).not.toHaveBeenCalled();
    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests/digest-a/history/run-recovered'
    );
  });

  it('keeps a transient run recovery visible and retryable', async () => {
    mocks.recoverPendingRun.mockResolvedValue(null);
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({
        error: 'Failed to recover Message Digest run',
        preparation: null,
        pendingRunRecoveryDefinitionId: 'digest-a',
      })
    );
    const user = userEvent.setup();

    renderDetail();

    expect(
      await screen.findByRole('dialog', { name: 'Run and send this digest?' })
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to recover Message Digest run');
    await user.click(screen.getByRole('button', { name: 'Retry run recovery' }));
    expect(mocks.recoverPendingRun).toHaveBeenCalledTimes(2);
    expect(mocks.prepareRun).not.toHaveBeenCalled();
  });

  it('keeps pending recovery ahead of preparation after Cancel and another Run now', async () => {
    mocks.recoverPendingRun.mockResolvedValue(null);
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({
        error: 'Failed to recover Message Digest run',
        preparation: null,
        pendingRunRecoveryDefinitionId: 'digest-a',
      })
    );
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('dialog', { name: 'Run and send this digest?' });
    await waitFor(() => expect(mocks.recoverPendingRun).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('dialog', { name: 'Run and send this digest?' })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run now' }));

    await waitFor(() => expect(mocks.recoverPendingRun).toHaveBeenCalledTimes(2));
    expect(mocks.prepareRun).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'Run and send this digest?' })
    ).toBeInTheDocument();
  });

  it('blocks direct Run intent for digest B until the pending run for digest A is recovered', async () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({
        definition: {
          ...definition(),
          id: 'digest-b',
          name: 'Digest B',
        },
      })
    );
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({ pendingRunRecoveryDefinitionId: 'digest-a' })
    );

    renderDetail({
      initialPath: '/whatsapp/message-digests/digest-b',
      state: { openRun: true },
    });

    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(
      screen.getByText('Recover the pending Message Digest run before starting another.')
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Recover pending run' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a'
    );
    await waitFor(() => {
      expect(mocks.prepareRun).not.toHaveBeenCalled();
      expect(mocks.recoverPendingRun).not.toHaveBeenCalled();
    });
  });

  it('blocks direct and routed deletion of digest A while its run needs recovery', () => {
    mocks.useMessageDigestSourceAvailability.mockReturnValue(
      sourceResult({ availability: 'active', isRefreshing: true })
    );
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({ pendingRunRecoveryDefinitionId: 'digest-a' })
    );

    renderDetail({ state: { openDelete: true } });

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(
      screen.getByText('Recover the pending Message Digest run before deleting this digest.')
    ).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Delete Message Digest?' })).not.toBeInTheDocument();
    expect(mocks.startDeletion).not.toHaveBeenCalled();
  });

  it('keeps deletion of digest B available while digest A needs recovery', () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({
        definition: {
          ...definition(),
          id: 'digest-b',
          name: 'Digest B',
        },
      })
    );
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({ pendingRunRecoveryDefinitionId: 'digest-a' })
    );

    renderDetail({
      initialPath: '/whatsapp/message-digests/digest-b',
      state: { openDelete: true },
    });

    expect(screen.getByRole('dialog', { name: 'Delete Message Digest?' })).toBeInTheDocument();
  });

  it('waits for fresh source checks before automatic pending-run recovery', async () => {
    mocks.useMessageDigestSourceAvailability.mockReturnValue(
      sourceResult({ availability: 'active', isRefreshing: true })
    );
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({ pendingRunRecoveryDefinitionId: 'digest-a' })
    );

    const view = renderDetail();

    expect(mocks.recoverPendingRun).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(
      screen.getByText('Wait for the Private WhatsApp status check before running.')
    ).toBeInTheDocument();

    mocks.useMessageDigestSourceAvailability.mockReturnValue(sourceResult());
    view.rerender(<DetailTestRouter />);

    await waitFor(() => expect(mocks.recoverPendingRun).toHaveBeenCalledOnce());
  });

  it('disables manual pending-run recovery if a source refresh starts while its dialog is open', async () => {
    mocks.recoverPendingRun.mockResolvedValue(null);
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({
        error: 'Failed to recover Message Digest run',
        preparation: null,
        pendingRunRecoveryDefinitionId: 'digest-a',
      })
    );
    const user = userEvent.setup();
    const view = renderDetail();
    await screen.findByRole('dialog', { name: 'Run and send this digest?' });
    await waitFor(() => expect(mocks.recoverPendingRun).toHaveBeenCalledOnce());

    mocks.useMessageDigestSourceAvailability.mockReturnValue(
      sourceResult({ availability: 'active', isRefreshing: true })
    );
    view.rerender(<DetailTestRouter />);

    const dialog = screen.getByRole('dialog', { name: 'Run and send this digest?' });
    const retry = within(dialog).getByRole('button', { name: 'Retry run recovery' });
    expect(retry).toBeDisabled();
    expect(
      within(dialog).getByText('Wait for the Private WhatsApp status check before running.')
    ).toBeInTheDocument();
    await user.click(retry);
    expect(mocks.recoverPendingRun).toHaveBeenCalledOnce();
  });

  it('disables Run now with a visible reason when primary WhatsApp is not ready', () => {
    mocks.useMessageDigestDeliveryReadiness.mockReturnValue(
      readinessResult({
        readiness: {
          status: 'disconnected',
          observationVersion: 'mapping-v2',
          observedAt: '2026-07-27T12:00:00.000Z',
        },
      })
    );
    renderDetail();

    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(screen.getByText(/Reconnect WhatsApp before running this digest/i)).toBeInTheDocument();
  });

  it('blocks direct and routed Run while the current source status check is unavailable', () => {
    mocks.useMessageDigestSourceAvailability.mockReturnValue(
      sourceResult({ availability: 'unavailable', error: 'Synthetic source status failure' })
    );
    renderDetail({ state: { openRun: true } });

    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(
      screen.getByText('Retry the Private WhatsApp status check before running.')
    ).toBeVisible();
    expect(mocks.prepareRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Run and send this digest?' })).not.toBeInTheDocument();
  });

  it('offers an accessible retry when the Private WhatsApp source check fails', async () => {
    const user = userEvent.setup();
    mocks.useMessageDigestSourceAvailability.mockReturnValue(
      sourceResult({ availability: 'unavailable', error: 'Synthetic source status failure' })
    );
    renderDetail();

    const alert = screen.getByRole('alert', { name: 'Private WhatsApp source status' });
    expect(alert).toHaveTextContent('Private WhatsApp source status could not be confirmed');
    await user.click(within(alert).getByRole('button', { name: 'Retry source check' }));
    expect(mocks.sourceRefresh).toHaveBeenCalledOnce();
  });

  it('disables Run now for a paused digest before preparing a run', () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({
        definition: { ...definition(), status: 'paused', listStatus: 'paused' },
      })
    );

    renderDetail();

    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(screen.getByText('Resume this digest before running it.')).toBeInTheDocument();
    expect(mocks.prepareRun).not.toHaveBeenCalled();
  });

  it('pauses atomically with revision CAS and adopts the authoritative PATCH response', async () => {
    const user = userEvent.setup();
    const update = deferred<MessageDigestDefinition | null>();
    mocks.updateDigest.mockReturnValue(update.promise);
    mocks.definitionAdopt.mockImplementation((nextDefinition: MessageDigestDefinition) => {
      mocks.useMessageDigestDefinition.mockReturnValue(
        definitionResult({
          definition: nextDefinition,
        })
      );
    });
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Pause digest' }));

    expect(mocks.updateDigest).toHaveBeenCalledWith('digest-a', {
      expectedRevision: 7,
      patch: { status: 'paused' },
    });
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pausing digest…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(mocks.definitionRefresh).not.toHaveBeenCalled();

    const updatedDefinition = {
      ...definition(),
      status: 'paused' as const,
      listStatus: 'paused' as const,
      revision: 8,
      nextRunAt: '2026-07-29T05:30:00.000Z',
    };
    update.resolve(updatedDefinition);
    await waitFor(() => expect(mocks.definitionAdopt).toHaveBeenCalledWith(updatedDefinition));
    expect(mocks.definitionRefresh).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Resume digest' })).toBeInTheDocument();
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0);
    expect(screen.queryByText('Jul 29, 2026, 7:30 AM')).not.toBeInTheDocument();
  });

  it('reloads a lifecycle revision conflict before allowing a retry with the latest revision', async () => {
    const user = userEvent.setup();
    const latestDefinition = {
      ...definition(),
      status: 'paused' as const,
      listStatus: 'paused' as const,
      revision: 12,
    };
    mocks.updateDigest
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...definition(), revision: 13 });
    mocks.definitionRefreshWithResult.mockImplementationOnce(async () => {
      mocks.useMessageDigestDefinition.mockReturnValue(
        definitionResult({ definition: latestDefinition })
      );
      return true;
    });
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Pause digest' }));

    expect(mocks.definitionRefreshWithResult).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The latest state is loaded. Review it and try again.'
    );
    const resume = screen.getByRole('button', { name: 'Resume digest' });
    expect(resume).toBeEnabled();

    await user.click(resume);

    expect(mocks.updateDigest).toHaveBeenNthCalledWith(2, 'digest-a', {
      expectedRevision: 12,
      patch: { status: 'active' },
    });
  });

  it('reloads an in-progress pause conflict and keeps the confirmed lifecycle visible', async () => {
    const user = userEvent.setup();
    mocks.updateDigest.mockResolvedValueOnce(null);
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({ error: 'A Message Digest run is already in progress.' })
    );
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Pause digest' }));

    expect(mocks.definitionRefreshWithResult).toHaveBeenCalledOnce();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The latest state is loaded. Review it and try again.'
    );
    expect(screen.getByRole('button', { name: 'Pause digest' })).toBeEnabled();
  });

  it('keeps the confirmed view and explains recovery when conflict reload fails', async () => {
    const user = userEvent.setup();
    mocks.updateDigest.mockResolvedValueOnce(null);
    mocks.definitionRefreshWithResult.mockResolvedValueOnce(false);
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Pause digest' }));

    expect(mocks.definitionRefreshWithResult).toHaveBeenCalledOnce();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause digest' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Refresh this page to load the latest state, then try again.'
    );
  });

  it.each([
    ['disconnected', 'Reconnect WhatsApp delivery before resuming this digest.'],
    ['mapping_missing', 'Map a primary WhatsApp number before resuming this digest.'],
    ['delivery_disabled', 'Enable WhatsApp delivery before resuming this digest.'],
  ] as const)('blocks resume for delivery readiness %s with a visible settings action', (status, copy) => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({
        definition: { ...definition(), status: 'paused', listStatus: 'paused' },
      })
    );
    mocks.useMessageDigestDeliveryReadiness.mockReturnValue(
      readinessResult({
        readiness: {
          status,
          observationVersion: 'mapping-v2',
          observedAt: '2026-07-27T12:00:00.000Z',
        },
      })
    );

    renderDetail();

    expect(screen.getByRole('button', { name: 'Resume digest' })).toBeDisabled();
    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open WhatsApp settings' })).toHaveAttribute(
      'href',
      '/settings/whatsapp'
    );
    expect(mocks.updateDigest).not.toHaveBeenCalled();
  });

  it('blocks run and resume while the source conversation is unavailable', () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({
        definition: {
          ...definition(),
          status: 'paused',
          listStatus: 'needs_attention',
          attentionCode: 'SOURCE_NOT_FOUND',
        },
      })
    );

    renderDetail();

    expect(screen.getByRole('button', { name: 'Resume digest' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(
      screen.getByText('Choose an available source before resuming this digest.')
    ).toBeVisible();
  });

  it.each([
    ['queued', 'queued'],
    ['processing', 'aggregating'],
  ] as const)(
    'blocks Resume while the latest digest is %s and repeats the guard in the action handler',
    (generationStatus, processingStage) => {
      mocks.useMessageDigestDefinition.mockReturnValue(
        definitionResult({
          definition: {
            ...definition(),
            status: 'paused',
            listStatus: 'paused',
            latestRun: {
              id: `run-${generationStatus}`,
              startedAt: '2026-07-27T12:00:00.000Z',
              generationStatus,
              processingStage,
              deliveryStatus: 'not_sent',
            },
          },
        })
      );

      renderDetail();

      const resume = screen.getByRole('button', { name: 'Resume digest' });
      expect(resume).toBeDisabled();
      expect(
        screen.getByText('Wait for the current digest run to finish before resuming.')
      ).toBeVisible();
      fireEvent.click(resume);
      expect(mocks.updateDigest).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['loading', null, 'Wait for the Private WhatsApp status check before resuming.'],
    ['missing', null, 'Connect Private WhatsApp before resuming this digest.'],
    [
      'unavailable',
      'Synthetic source status failure',
      'Retry the Private WhatsApp status check before resuming.',
    ],
  ] as const)(
    'blocks Resume when Private WhatsApp source availability is %s',
    (availability, error, reason) => {
      mocks.useMessageDigestDefinition.mockReturnValue(
        definitionResult({
          definition: { ...definition(), status: 'paused', listStatus: 'paused' },
        })
      );
      mocks.useMessageDigestSourceAvailability.mockReturnValue(
        sourceResult({ availability, error })
      );

      renderDetail();

      const resume = screen.getByRole('button', { name: 'Resume digest' });
      expect(resume).toBeDisabled();
      expect(screen.getByText(reason)).toBeVisible();
      fireEvent.click(resume);
      expect(mocks.updateDigest).not.toHaveBeenCalled();
    }
  );

  it('resumes a terminal SOURCE_TOO_LARGE digest with exactly one PATCH', async () => {
    const user = userEvent.setup();
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({
        definition: {
          ...definition(),
          status: 'paused',
          listStatus: 'needs_attention',
          attentionCode: 'SOURCE_TOO_LARGE',
          latestRun: {
            id: 'run-source-too-large',
            startedAt: '2026-07-27T12:00:00.000Z',
            generationStatus: 'failed',
            processingStage: 'failed',
            deliveryStatus: 'not_sent',
          },
        },
      })
    );

    renderDetail();
    const resume = screen.getByRole('button', { name: 'Resume digest' });
    expect(resume).toBeEnabled();
    await user.click(resume);

    expect(mocks.updateDigest).toHaveBeenCalledOnce();
    expect(mocks.updateDigest).toHaveBeenCalledWith('digest-a', {
      expectedRevision: 7,
      patch: { status: 'active' },
    });
  });

  it('describes SOURCE_TOO_LARGE as a retained window and keeps Run available after Resume', () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({
        definition: {
          ...definition(),
          listStatus: 'needs_attention',
          attentionCode: 'SOURCE_TOO_LARGE',
          latestRun: {
            id: 'run-source-too-large-active',
            startedAt: '2026-07-27T12:00:00.000Z',
            generationStatus: 'failed',
            processingStage: 'failed',
            deliveryStatus: 'not_sent',
          },
        },
      })
    );

    renderDetail();

    expect(screen.getByRole('button', { name: 'Run now' })).toBeEnabled();
    expect(screen.getByText('Run now to retry the retained window.')).toBeVisible();
    expect(screen.getByText('Run now to retry retained window')).toBeVisible();
    expect(screen.queryByText('Source unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText(/source conversation must be available/i)).not.toBeInTheDocument();
  });

  it('shows the exact weekly cadence on the detail schedule card', () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({
        definition: {
          ...definition(),
          schedule: {
            kind: 'weekly',
            weekday: 'thursday',
            localTime: '18:10',
            timeZone: 'Europe/Warsaw',
          },
        },
      })
    );

    renderDetail();

    expect(screen.getByText('Every Thursday at 18:10')).toBeInTheDocument();
  });

  it('disables edit, run, and delete while deletion is already in progress', () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({
        definition: {
          ...definition(),
          status: 'deleting',
          listStatus: 'paused',
          erasureRequestId: 'erasure-a',
        },
      })
    );

    renderDetail();

    expect(screen.queryByRole('link', { name: 'Edit digest' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit digest' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByText('Deletion is already in progress.')).toBeInTheDocument();
    expect(screen.getByText('Deleting')).toBeInTheDocument();
    expect(mocks.useMessageDigestDeletion).toHaveBeenCalledWith('digest-a', {
      erasureRequestId: 'erasure-a',
    });
  });

  it('opens deletion from routed intent without exposing implementation identifiers', () => {
    renderDetail({ state: { openDelete: true } });

    expect(screen.getByRole('dialog', { name: 'Delete Message Digest?' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('erasure-a');
  });

  it.each(['Cancel', 'Escape'] as const)(
    'returns focus to the local Delete trigger after closing with %s',
    async (closeAction) => {
      const user = userEvent.setup();
      renderDetail();
      const deleteTrigger = screen.getByRole('button', { name: 'Delete', exact: true });

      await user.click(deleteTrigger);
      expect(screen.getByRole('dialog', { name: 'Delete Message Digest?' })).toBeInTheDocument();
      if (closeAction === 'Cancel') {
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
      } else {
        await user.keyboard('{Escape}');
      }

      await waitFor(() => expect(deleteTrigger).toHaveFocus());
    }
  );

  it.each(['Cancel', 'Escape'] as const)(
    'returns focus to the detail heading after routed deletion closes with %s',
    async (closeAction) => {
      const user = userEvent.setup();
      renderDetail({ state: { openDelete: true } });
      const heading = document.getElementById('page-title');
      expect(heading).not.toBeNull();

      if (closeAction === 'Cancel') {
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
      } else {
        await user.keyboard('{Escape}');
      }

      await waitFor(() => expect(heading).toHaveFocus());
    }
  );

  it('shows an owner-safe not-found state without echoing the requested ID', () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({ definition: null, isNotFound: true })
    );
    renderDetail({ initialPath: '/whatsapp/message-digests/private-secret-id' });

    expect(screen.getByRole('heading', { name: 'Message Digest not found' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('private-secret-id');
    expect(screen.getByRole('link', { name: 'Back to Message Digests' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests'
    );
  });

  it('keeps durable deletion recovery mounted after the definition document disappears', () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({ definition: null, isNotFound: true })
    );
    mocks.useMessageDigestDeletion.mockReturnValue(
      deletionResult({
        isDeleting: true,
        isRecovering: true,
        erasure: {
          erasureRequestId: 'erasure-a',
          definitionId: 'digest-a',
          status: 'in_progress',
          stage: 'legacy',
          deletedCounts: { runs: 3, outbox: 1, state: 1, definition: 1, legacy: 0 },
          updatedAt: '2026-07-27T12:00:00.000Z',
          completedAt: null,
          nextAction: 'resume_delete',
        },
      })
    );

    renderDetail();

    expect(mocks.useMessageDigestDeletion).toHaveBeenCalledWith('digest-a', {
      erasureRequestId: null,
    });
    expect(screen.getByRole('dialog', { name: 'Deleting Message Digest' })).toBeInTheDocument();
    expect(screen.getByText('Removing migrated legacy history')).toBeInTheDocument();
  });

  it('redirects once when recovered deletion reaches its terminal tombstone after 404', async () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({ definition: null, isNotFound: true })
    );
    mocks.useMessageDigestDeletion.mockReturnValue(
      deletionResult({
        erasure: {
          erasureRequestId: 'erasure-a',
          definitionId: 'digest-a',
          status: 'completed',
          stage: 'completed',
          deletedCounts: { runs: 3, outbox: 1, state: 1, definition: 1, legacy: 1 },
          updatedAt: '2026-07-27T12:01:00.000Z',
          completedAt: '2026-07-27T12:01:00.000Z',
          nextAction: null,
        },
      })
    );

    renderDetail();

    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests'
    );
  });
});

function renderDetail({
  initialPath = '/whatsapp/message-digests/digest-a',
  state,
  withRouteSwitcher = false,
}: {
  initialPath?: string;
  state?: Record<string, unknown>;
  withRouteSwitcher?: boolean;
} = {}): ReturnType<typeof render> {
  return render(
    <DetailTestRouter
      initialPath={initialPath}
      state={state}
      withRouteSwitcher={withRouteSwitcher}
    />
  );
}

function DetailTestRouter({
  initialPath = '/whatsapp/message-digests/digest-a',
  state,
  withRouteSwitcher = false,
}: {
  initialPath?: string;
  state?: Record<string, unknown>;
  withRouteSwitcher?: boolean;
} = {}): React.JSX.Element {
  return (
    <MemoryRouter initialEntries={[{ pathname: initialPath, state }]}>
      {withRouteSwitcher ? <DetailRouteSwitcher /> : null}
      <Routes>
        <Route
          path="/whatsapp/message-digests/:definitionId"
          element={<WhatsAppMessageDigestDetailPage />}
        />
        <Route
          path="/whatsapp/message-digests/:definitionId/history/:runId"
          element={<LocationProbe />}
        />
        <Route
          path="/whatsapp/message-digests/:definitionId/history"
          element={<LocationProbe />}
        />
        <Route path="/whatsapp/message-digests" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function DetailRouteSwitcher(): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={(): void =>
        void navigate('/whatsapp/message-digests/digest-b', {
          state: { focusHeading: true },
        })
      }
    >
      Open second digest
    </button>
  );
}

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return (
    <pre data-testid="location-probe">
      {location.pathname} {JSON.stringify(location.state)}
    </pre>
  );
}

function definitionResult(
  overrides: Partial<UseMessageDigestDefinitionResult> = {}
): UseMessageDigestDefinitionResult {
  return {
    definition: definition(),
    isLoading: false,
    isRefreshing: false,
    isNotFound: false,
    error: null,
    refresh: mocks.definitionRefresh,
    refreshWithResult: mocks.definitionRefreshWithResult,
    adoptDefinition: mocks.definitionAdopt,
    ...overrides,
  };
}

function readinessResult(
  overrides: Partial<UseMessageDigestDeliveryReadinessResult> = {}
): UseMessageDigestDeliveryReadinessResult {
  return {
    readiness: {
      status: 'ready',
      maskedPrimaryNumber: '•••• 1234',
      observationVersion: 'mapping-v1',
      observedAt: '2026-07-27T12:00:00.000Z',
    },
    isLoading: false,
    isRefreshing: false,
    error: null,
    refresh: mocks.readinessRefresh,
    ...overrides,
  };
}

function sourceResult(
  overrides: Partial<UseMessageDigestSourceAvailabilityResult> = {}
): UseMessageDigestSourceAvailabilityResult {
  return {
    availability: 'active',
    isRefreshing: false,
    error: null,
    refresh: mocks.sourceRefresh,
    ...overrides,
  };
}

function historyResult(
  overrides: Partial<UseMessageDigestHistoryResult> = {}
): UseMessageDigestHistoryResult {
  return {
    items: [run('run-latest'), run('run-previous')],
    nextCursor: null,
    isInitialLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    error: null,
    refreshError: null,
    loadMoreError: null,
    refresh: mocks.historyRefresh,
    loadMore: mocks.historyLoadMore,
    ...overrides,
  };
}

function commandsResult(
  overrides: Partial<UseMessageDigestCommandsResult> = {}
): UseMessageDigestCommandsResult {
  return {
    error: null,
    hasRevisionConflict: false,
    preparation: preparation(),
    requiresRunReconfirmation: false,
    isCreating: false,
    isUpdating: false,
    isPreparingRun: false,
    isConfirmingRun: false,
    isRecoveringRun: false,
    pendingRunRecoveryDefinitionId: null,
    createDigest: vi.fn(),
    updateDigest: mocks.updateDigest,
    prepareRun: mocks.prepareRun,
    confirmRun: mocks.confirmRun,
    recoverPendingRun: mocks.recoverPendingRun,
    finishRunRequest: mocks.finishRunRequest,
    clearError: mocks.clearError,
    ...overrides,
  };
}

function runResult(overrides: Partial<UseMessageDigestRunResult> = {}): UseMessageDigestRunResult {
  return {
    run: run('run-latest'),
    isInitialLoading: false,
    isPolling: false,
    isNotFound: false,
    error: null,
    pollError: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

function deletionResult(
  overrides: Partial<UseMessageDigestDeletionResult> = {}
): UseMessageDigestDeletionResult {
  return {
    erasure: null,
    isDeleting: false,
    isRecovering: false,
    error: null,
    startDeletion: mocks.startDeletion,
    retry: mocks.retryDeletion,
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function definition(): MessageDigestDefinition {
  return {
    id: 'digest-a',
    name: 'Daily fishing brief',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    erasureRequestId: null,
    revision: 7,
    sourceLocked: true,
    source: { chatId: 'chat-fishing', chatType: 'group', displayName: 'Fishing group' },
    instructions: {
      templateId: 'fishing_group',
      text: 'Summarize the important fishing facts supported by source messages.',
    },
    schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
    delivery: { type: 'whatsapp_primary' },
    checkpointAt: '2026-07-26T05:30:00.000Z',
    nextRunAt: '2026-07-28T05:30:00.000Z',
    lastRunAt: '2026-07-27T05:30:00.000Z',
    latestRun: null,
    createdAt: '2026-07-03T12:00:00.000Z',
    updatedAt: '2026-07-27T12:00:00.000Z',
  };
}

function preparation(): MessageDigestRunPreparation {
  return {
    token: 'short-lived-token',
    preparedAt: '2026-07-27T12:00:00.000Z',
    window: {
      start: '2026-07-26T05:30:00.000Z',
      end: '2026-07-27T05:30:00.000Z',
      timeZone: 'Europe/Warsaw',
    },
    source: { chatType: 'group', displayName: 'Fishing group' },
    deliveryReadiness: { status: 'ready', maskedPrimaryNumber: '•••• 1234' },
  };
}

function run(id: string): MessageDigestRun {
  return {
    id,
    definitionId: 'digest-a',
    definitionRevision: 3,
    trigger: 'manual',
    window: {
      start: '2026-07-26T05:30:00.000Z',
      end: '2026-07-27T05:30:00.000Z',
      scheduledBoundary: '2026-07-27T05:30:00.000Z',
    },
    generationStatus: 'completed',
    processingStage: 'completed',
    attempts: 1,
    source: { chatType: 'group', displayName: 'Fishing group' },
    instructions: { ...definition().instructions, revision: 'instructions-v1' },
    schedule: definition().schedule,
    content: {
      headline: 'Today on the water',
      summaryMarkdown: 'Two plans were agreed.',
      evidenceMessageRefs: [],
    },
    effectiveMessageCount: 17,
    promptVersion: 'message-digest-v1',
    model: LlmModels.Gemini25Flash,
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    delivery: {
      type: 'whatsapp_primary',
      status: 'sent',
      acceptedAt: '2026-07-27T05:31:00.000Z',
      failedAt: null,
      failureCode: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T05:30:00.000Z',
    updatedAt: '2026-07-27T05:31:00.000Z',
    completedAt: '2026-07-27T05:30:30.000Z',
  };
}
