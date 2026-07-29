/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LlmModels } from '@intexuraos/llm-contract';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  UseMessageDigestDefinitionResult,
  UseMessageDigestHistoryResult,
  UseMessageDigestRunResult,
} from '@/hooks/useMessageDigests';
import type {
  MessageDigestDefinition,
  MessageDigestDeliveryStatus,
  MessageDigestGenerationStatus,
  MessageDigestRun,
  RetryMessageDigestRunResponse,
} from '@/types/messageDigests';

const mocks = vi.hoisted(() => ({
  useMessageDigestDefinition: vi.fn(),
  useMessageDigestHistory: vi.fn(),
  useMessageDigestRun: vi.fn(),
  definitionRefresh: vi.fn(),
  definitionRefreshWithResult: vi.fn(),
  definitionAdopt: vi.fn(),
  historyRefresh: vi.fn(),
  historyLoadMore: vi.fn(),
  runRefresh: vi.fn(),
  retryRun: vi.fn(),
  clearRetryError: vi.fn(),
}));

vi.mock('@/hooks/useMessageDigests', () => ({
  useMessageDigestDefinition: (definitionId: string): UseMessageDigestDefinitionResult =>
    mocks.useMessageDigestDefinition(definitionId),
  useMessageDigestHistory: (
    definitionId: string,
    options: unknown
  ): UseMessageDigestHistoryResult => mocks.useMessageDigestHistory(definitionId, options),
  useMessageDigestRun: (definitionId: string, runId: string): UseMessageDigestRunResult =>
    mocks.useMessageDigestRun(definitionId, runId),
}));

vi.mock('@/components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <main>{children}</main>
  ),
}));

import { WhatsAppMessageDigestHistoryPage } from '../WhatsAppMessageDigestHistoryPage.js';
import { WhatsAppMessageDigestRunPage } from '../WhatsAppMessageDigestRunPage.js';

describe('WhatsAppMessageDigestHistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.definitionRefresh.mockResolvedValue(undefined);
    mocks.historyRefresh.mockResolvedValue(undefined);
    mocks.historyLoadMore.mockResolvedValue(undefined);
    mocks.useMessageDigestDefinition.mockReturnValue(definitionResult());
    mocks.useMessageDigestHistory.mockReturnValue(historyResult());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('restores exact URL filters, passes them to the API hook, and clears deterministically', async () => {
    const user = userEvent.setup();
    renderHistory(
      '/whatsapp/message-digests/digest-a/history?from=2026-07-01&to=2026-07-27&generationStatus=completed&deliveryStatus=sent&direction=asc'
    );

    expect(screen.getByLabelText('From date')).toHaveValue('2026-07-01');
    expect(screen.getByLabelText('To date')).toHaveValue('2026-07-27');
    expect(screen.getByLabelText('Generation status')).toHaveValue('completed');
    expect(screen.getByLabelText('WhatsApp status')).toHaveValue('sent');
    expect(screen.getByLabelText('History order')).toHaveValue('asc');
    expect(mocks.useMessageDigestHistory).toHaveBeenLastCalledWith('digest-a', {
      limit: 25,
      fromDate: '2026-07-01',
      toDate: '2026-07-27',
      generationStatus: 'completed',
      deliveryStatus: 'sent',
      sort: 'windowStart',
      direction: 'asc',
    });

    await user.selectOptions(screen.getByLabelText('Generation status'), 'failed');
    expect(mocks.useMessageDigestHistory).toHaveBeenLastCalledWith(
      'digest-a',
      expect.objectContaining({ generationStatus: 'failed' })
    );
    expect(screen.getByTestId('search-probe')).toHaveTextContent('generationStatus=failed');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(mocks.useMessageDigestHistory).toHaveBeenLastCalledWith('digest-a', {
      limit: 25,
      sort: 'windowStart',
      direction: 'desc',
    });
    expect(screen.getByTestId('search-probe')).toHaveTextContent(/^$/);
  });

  it('keeps an invalid date draft out of the URL and API options until it is corrected', () => {
    renderHistory('/whatsapp/message-digests/digest-a/history?from=2026-07-01&to=2026-07-27');

    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-07-28' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'From date must be on or before To date.'
    );
    expect(screen.getByTestId('search-probe')).toHaveTextContent(
      'from=2026-07-01&to=2026-07-27'
    );
    expect(mocks.useMessageDigestHistory).toHaveBeenLastCalledWith('digest-a', {
      limit: 25,
      fromDate: '2026-07-01',
      toDate: '2026-07-27',
      sort: 'windowStart',
      direction: 'desc',
    });

    fireEvent.change(screen.getByLabelText('To date'), {
      target: { value: '2026-07-29' },
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent(
      'from=2026-07-28&to=2026-07-29'
    );
    expect(mocks.useMessageDigestHistory).toHaveBeenLastCalledWith('digest-a', {
      limit: 25,
      fromDate: '2026-07-28',
      toDate: '2026-07-29',
      sort: 'windowStart',
      direction: 'desc',
    });
  });

  it('renders semantic desktop columns, local times, separate statuses, and canonical result links', () => {
    renderHistory();

    const table = screen.getByRole('table', { name: 'Message Digest run history' });
    for (const heading of [
      'Started',
      'Message window',
      'Messages',
      'Generation',
      'WhatsApp',
      'Duration',
      'Action',
    ]) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(within(table).getAllByText('Completed').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Sent').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('17').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('30s').length).toBeGreaterThan(0);
    expect(within(table).getAllByRole('link', { name: 'View result' })[0]).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a/history/run-a'
    );
    const started = within(table).getAllByText(/Jul 27, 2026/)[0];
    expect(started?.closest('time')).toHaveAttribute('dateTime', '2026-07-27T05:30:00.000Z');
  });

  it('focuses the history heading when the previous route requests a focus transfer', () => {
    renderHistory('/whatsapp/message-digests/digest-a/history', { focusHeading: true });

    expect(screen.getByRole('heading', { name: 'Run history' })).toHaveFocus();
  });

  it('formats each historical run in its persisted schedule zone after the definition changes', () => {
    const historicalRun = {
      ...run('run-historical', 'completed', 'sent'),
      definitionRevision: 3,
      schedule: { kind: 'daily' as const, localTime: '01:30', timeZone: 'America/New_York' },
    };
    mocks.useMessageDigestHistory.mockReturnValue(historyResult({ items: [historicalRun] }));

    renderHistory();

    const table = screen.getByRole('table', { name: 'Message Digest run history' });
    expect(within(table).getAllByText('Jul 27, 2026, 1:30 AM').length).toBeGreaterThan(0);
    expect(within(table).queryByText('Jul 27, 2026, 7:30 AM')).not.toBeInTheDocument();
  });

  it('retains rows on pagination errors and exposes one guarded Load more action', async () => {
    const user = userEvent.setup();
    mocks.useMessageDigestHistory.mockReturnValue(
      historyResult({ nextCursor: 'next-page', loadMoreError: 'Next page unavailable' })
    );
    renderHistory();

    expect(screen.getByRole('alert')).toHaveTextContent('Next page unavailable');
    expect(screen.getAllByRole('link', { name: 'View result' }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(mocks.historyLoadMore).toHaveBeenCalledTimes(1);
  });

  it('keeps confirmed rows visible when a manual refresh fails', async () => {
    const user = userEvent.setup();
    mocks.useMessageDigestHistory.mockReturnValue(
      historyResult({ refreshError: 'Fresh history is temporarily unavailable' })
    );
    renderHistory();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Fresh history is temporarily unavailable'
    );
    expect(screen.getAllByRole('link', { name: 'View result' }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(mocks.historyRefresh).toHaveBeenCalledOnce();
  });

  it('distinguishes an empty history from a filtered no-match state and clears it', async () => {
    const user = userEvent.setup();
    mocks.useMessageDigestHistory.mockReturnValue(historyResult({ items: [] }));
    renderHistory('/whatsapp/message-digests/digest-a/history?generationStatus=failed');

    expect(
      screen.getByRole('heading', { name: 'No runs match these filters' })
    ).toBeInTheDocument();
    const clearButtons = screen.getAllByRole('button', { name: 'Clear filters' });
    await user.click(clearButtons.at(-1) as HTMLButtonElement);
    expect(screen.getByTestId('search-probe')).toHaveTextContent(/^$/);
  });

  it('polls active history sequentially until terminal and stops after terminal or unmount', async () => {
    vi.useFakeTimers();
    const finalRefresh = deferred<undefined>();
    mocks.historyRefresh
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(finalRefresh.promise);
    mocks.useMessageDigestHistory.mockReturnValue(
      historyResult({ items: [run('run-active', 'processing', 'pending')] })
    );
    const rendered = renderHistory();

    expect(screen.getByRole('status', { name: 'Active run updates' })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(mocks.historyRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(mocks.historyRefresh).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(mocks.historyRefresh).toHaveBeenCalledTimes(2);

    mocks.useMessageDigestHistory.mockReturnValue(
      historyResult({ items: [run('run-active', 'completed', 'sent')] })
    );
    finalRefresh.resolve(undefined);
    await act(async () => Promise.resolve());
    rendered.rerender(historyTree());
    expect(screen.queryByRole('status', { name: 'Active run updates' })).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(mocks.historyRefresh).toHaveBeenCalledTimes(2);

    rendered.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(mocks.historyRefresh).toHaveBeenCalledTimes(2);
  });

  it('uses a neutral owner-safe state when the definition is missing', () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({ definition: null, isNotFound: true })
    );
    renderHistory('/whatsapp/message-digests/private-definition/history');

    expect(screen.getByRole('heading', { name: 'Message Digest not found' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('private-definition');
  });
});

describe('WhatsAppMessageDigestRunPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.definitionRefresh.mockResolvedValue(undefined);
    mocks.retryRun.mockResolvedValue(null);
    mocks.useMessageDigestDefinition.mockReturnValue(definitionResult());
    mocks.useMessageDigestRun.mockReturnValue(runResult());
  });

  afterEach(() => {
    cleanup();
    document.documentElement.style.fontSize = '';
  });

  it('renders sanitized output, snapshots, a safe delivery timeline, and collapsed technical details', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    mocks.useMessageDigestRun.mockReturnValue(
      runResult({
        run: {
          ...run('run-a', 'completed', 'sent'),
          definitionRevision: 3,
          schedule: {
            kind: 'daily',
            localTime: '01:30',
            timeZone: 'America/New_York',
          },
        },
      })
    );
    renderRun();

    expect(screen.getByRole('link', { name: 'Back to history' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a/history'
    );
    expect(screen.getByRole('heading', { name: 'Daily fishing brief' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Today on the water' })).toBeInTheDocument();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'P' && element.textContent === 'Two plans were agreed.'
      )
    ).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByTestId('generation-status')).toHaveTextContent('Completed');
    expect(screen.getByTestId('delivery-status')).toHaveTextContent('Sent');
    expect(screen.getByText('17 messages')).toBeInTheDocument();
    expect(screen.getByText(definition().instructions.text)).toBeInTheDocument();
    expect(screen.getByText(LlmModels.Gemini25Flash)).toBeInTheDocument();
    expect(screen.getByText('message-digest-v1')).toBeInTheDocument();
    expect(screen.getByText('Definition revision').parentElement).toHaveTextContent('3');
    expect(screen.getByText('Definition revision').parentElement).not.toHaveTextContent('7');
    expect(screen.getByText('Generated')).toBeInTheDocument();
    expect(screen.getByText('Queued for WhatsApp')).toBeInTheDocument();
    expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
    const details = screen.getByText('Technical details').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('run-a');
    expect(details).not.toHaveTextContent('chat-fishing');

    await user.click(screen.getByRole('button', { name: 'Copy digest' }));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('Today on the water');
    expect(copied).toContain('Two plans were agreed.');
    expect(copied).not.toContain('**');
    expect(copied).not.toContain('run-a');
    expect(copied).not.toContain(definition().instructions.text);
    expect(await screen.findByRole('status', { name: 'Copy digest result' })).toHaveTextContent(
      'Digest copied'
    );
  });

  it('copies the exact visible Markdown text without deleting literal punctuation', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const punctuationRun = run('run-visible-copy', 'completed', 'sent');
    if (punctuationRun.content === null) throw new Error('Expected generated run content');
    punctuationRun.content = {
      ...punctuationRun.content,
      headline: 'Literal-safe digest',
      summaryMarkdown:
        'User `user_name` chose C# and wrote `a > b`.\n\nLiteral #topic: <https://example.com/path>',
    };
    mocks.useMessageDigestRun.mockReturnValue(runResult({ run: punctuationRun }));
    renderRun('/whatsapp/message-digests/digest-a/history/run-visible-copy');
    const renderedSummary = document.querySelector<HTMLElement>('.prose');
    if (renderedSummary === null) throw new Error('Rendered summary was not found');
    Object.defineProperty(renderedSummary, 'innerText', {
      configurable: true,
      value:
        'User user_name chose C# and wrote a > b.\n\nLiteral #topic: https://example.com/path',
    });

    await user.click(screen.getByRole('button', { name: 'Copy digest' }));

    expect(writeText).toHaveBeenCalledWith(
      'Literal-safe digest\n\nUser user_name chose C# and wrote a > b.\n\nLiteral #topic: https://example.com/path'
    );
  });

  it('blocks raw HTML, scriptable links, layout-breaking images, and unsafe link targets', () => {
    const unsafeMarkdown = run('run-markdown-safety', 'completed', 'sent');
    unsafeMarkdown.content = {
      headline: 'Safe rendering',
      summaryMarkdown:
        '[Safe source](https://example.com/path) [Unsafe action](javascript:alert(1)) ![Oversized private image](https://example.com/private.png) <script>private()</script>',
      evidenceMessageRefs: [],
    };
    mocks.useMessageDigestRun.mockReturnValue(runResult({ run: unsafeMarkdown }));
    renderRun('/whatsapp/message-digests/digest-a/history/run-markdown-safety');

    expect(screen.getByRole('link', { name: 'Safe source' })).toHaveAttribute(
      'href',
      'https://example.com/path'
    );
    expect(screen.getByRole('link', { name: 'Safe source' })).not.toHaveAttribute('target');
    expect(screen.queryByRole('link', { name: 'Unsafe action' })).not.toBeInTheDocument();
    expect(screen.getByText('Unsafe action')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('Oversized private image')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });

  it('retains an active run during a polling warning and announces live updates', () => {
    mocks.useMessageDigestRun.mockReturnValue(
      runResult({
        run: run('run-active', 'processing', 'pending'),
        isPolling: true,
        pollError: 'Live refresh unavailable',
      })
    );
    renderRun('/whatsapp/message-digests/digest-a/history/run-active');

    expect(screen.getByRole('status', { name: 'Run updates' })).toHaveTextContent(
      'Status updates automatically'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Live refresh unavailable');
    expect(screen.getByTestId('generation-status')).toHaveTextContent('Generating');
    expect(screen.getByTestId('delivery-status')).toHaveTextContent('Pending');
  });

  it('confirms a generation retry, locks the dialog while pending, and announces success', async () => {
    const user = userEvent.setup();
    const retryResponse = deferred<RetryMessageDigestRunResponse>();
    const failedRun = run('run-generation-failed', 'failed', 'not_sent');
    failedRun.safeFailureCode = 'LLM_UNAVAILABLE';
    mocks.retryRun.mockReturnValue(retryResponse.promise);
    mocks.useMessageDigestRun.mockReturnValue(
      runResult({ run: failedRun, retryStage: 'generation' })
    );
    renderRun('/whatsapp/message-digests/digest-a/history/run-generation-failed');

    expect(screen.getByRole('button', { name: 'Retry run' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry delivery' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry run' }));
    let dialog = screen.getByRole('dialog', { name: 'Retry summary generation?' });
    expect(dialog).toHaveTextContent('same run, message window, and configuration snapshot');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry run' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Retry run' }));
    dialog = screen.getByRole('dialog', { name: 'Retry summary generation?' });
    await user.click(within(dialog).getByRole('button', { name: 'Retry run' }));
    expect(within(dialog).getByRole('button', { name: 'Retrying…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Retry summary generation?' })).toBeInTheDocument();

    retryResponse.resolve({
      disposition: 'retried',
      stage: 'generation',
      run: run('run-generation-failed', 'queued', 'not_sent'),
    });
    expect(
      await screen.findByRole('status', { name: 'Retry run result' })
    ).toHaveTextContent('Summary generation restarted');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.retryRun).toHaveBeenCalledOnce();
  });

  it('keeps retry controls reachable at 200% zoom and a short viewport', async () => {
    const user = userEvent.setup();
    document.documentElement.style.fontSize = '200%';
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 });
    const failedRun = run('run-generation-failed', 'failed', 'not_sent');
    failedRun.safeFailureCode = 'LLM_UNAVAILABLE';
    mocks.useMessageDigestRun.mockReturnValue(
      runResult({ run: failedRun, retryStage: 'generation' })
    );
    renderRun('/whatsapp/message-digests/digest-a/history/run-generation-failed');

    await user.click(screen.getByRole('button', { name: 'Retry run' }));

    const dialog = screen.getByRole('dialog', { name: 'Retry summary generation?' });
    expect(dialog).toHaveClass(
      'max-h-[calc(100dvh-2rem)]',
      'w-[calc(100%-2rem)]',
      'max-w-lg',
      'overflow-y-auto',
      'overscroll-contain'
    );
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveClass('min-h-11');
    expect(within(dialog).getByRole('button', { name: 'Retry run' })).toHaveClass('min-h-11');
  });

  it('retries SOURCE_CHANGED as the same run and shows its exact immutable window', async () => {
    const user = userEvent.setup();
    const sourceChanged = run('run-source-changed', 'failed', 'not_sent');
    sourceChanged.safeFailureCode = 'SOURCE_CHANGED';
    mocks.retryRun.mockResolvedValue({
      disposition: 'retried',
      stage: 'generation',
      run: { ...sourceChanged, generationStatus: 'queued', processingStage: 'queued' },
    });
    mocks.useMessageDigestRun.mockReturnValue(
      runResult({ run: sourceChanged, retryStage: 'generation' })
    );

    renderRun('/whatsapp/message-digests/digest-a/history/run-source-changed');
    expect(mocks.useMessageDigestRun).toHaveBeenCalledWith('digest-a', 'run-source-changed');
    await user.click(screen.getByRole('button', { name: 'Retry run' }));
    const dialog = screen.getByRole('dialog', { name: 'Retry summary generation?' });
    expect(dialog).toHaveTextContent('same run, message window, and configuration snapshot');
    expect(dialog).toHaveTextContent('Jul 26, 2026, 7:30 AM');
    expect(dialog).toHaveTextContent('Jul 27, 2026, 7:30 AM');
    await user.click(within(dialog).getByRole('button', { name: 'Retry run' }));

    expect(mocks.retryRun).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Run now' })).not.toBeInTheDocument();
  });

  it('offers delivery retry only for a definitive safe failure and preserves content', async () => {
    const user = userEvent.setup();
    const failedDelivery = run('run-delivery-failed', 'completed', 'failed');
    failedDelivery.delivery.failureCode = 'PROVIDER_REJECTED';
    mocks.retryRun.mockResolvedValue({
      disposition: 'retried',
      stage: 'delivery',
      run: { ...failedDelivery, delivery: { ...failedDelivery.delivery, status: 'pending' } },
    });
    mocks.useMessageDigestRun.mockReturnValue(
      runResult({ run: failedDelivery, retryStage: 'delivery' })
    );
    renderRun('/whatsapp/message-digests/digest-a/history/run-delivery-failed');

    expect(screen.getByRole('heading', { name: 'Today on the water' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry delivery' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry run' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry delivery' }));
    const dialog = screen.getByRole('dialog', { name: 'Retry WhatsApp delivery?' });
    expect(dialog).toHaveTextContent('exact saved message and delivery identity');
    await user.click(within(dialog).getByRole('button', { name: 'Retry delivery' }));

    expect(
      await screen.findByRole('status', { name: 'Retry run result' })
    ).toHaveTextContent('WhatsApp delivery restarted');
    expect(mocks.retryRun).toHaveBeenCalledOnce();
  });

  it('warns about ambiguous delivery without exposing a blind retry', () => {
    mocks.useMessageDigestRun.mockReturnValue(
      runResult({ run: run('run-ambiguous', 'completed', 'ambiguous'), retryStage: null })
    );
    renderRun('/whatsapp/message-digests/digest-a/history/run-ambiguous');

    expect(screen.getByRole('alert')).toHaveTextContent('WhatsApp may already have this digest');
    expect(screen.getByRole('alert')).toHaveTextContent('Automatic retry is disabled');
    expect(screen.queryByRole('button', { name: /Retry (run|delivery)/u })).not.toBeInTheDocument();
  });

  it('renders source-too-large as a terminal safe generation failure without delivery or retry', () => {
    const sourceTooLarge = run('run-source-too-large', 'failed', 'not_sent');
    sourceTooLarge.safeFailureCode = 'SOURCE_TOO_LARGE';
    mocks.useMessageDigestRun.mockReturnValue(
      runResult({ run: sourceTooLarge, retryStage: null })
    );
    renderRun('/whatsapp/message-digests/digest-a/history/run-source-too-large');

    expect(screen.getByRole('heading', { name: 'Summary generation failed' })).toBeInTheDocument();
    expect(screen.getByTestId('generation-status')).toHaveTextContent('Failed');
    expect(screen.getByTestId('delivery-status')).toHaveTextContent('Not sent');
    expect(screen.queryByRole('button', { name: /Retry (run|delivery)/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy digest' })).not.toBeInTheDocument();
    expect(screen.getByText('Technical details').closest('details')).toHaveTextContent(
      'SOURCE_TOO_LARGE'
    );
  });

  it('copies only visible instructions and announces clipboard failure', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('Clipboard blocked'));
    renderRun();

    await user.click(screen.getByRole('button', { name: 'Copy instructions' }));
    expect(writeText).toHaveBeenCalledWith(definition().instructions.text);
    expect(
      await screen.findByRole('status', { name: 'Copy instructions result' })
    ).toHaveTextContent('Couldn’t copy instructions');
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain('chat-fishing');
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain('run-a');
  });

  it('focuses the result heading after a confirmed run navigation', () => {
    renderRun('/whatsapp/message-digests/digest-a/history/run-a', { focusHeading: true });

    expect(screen.getByRole('heading', { name: 'Daily fishing brief' })).toHaveFocus();
  });

  it('treats no activity as a successful terminal result without a send action', () => {
    mocks.useMessageDigestRun.mockReturnValue(
      runResult({ run: run('run-empty', 'skipped_no_activity', 'not_sent') })
    );
    renderRun('/whatsapp/message-digests/digest-a/history/run-empty');

    expect(screen.getByText('No new messages in this window')).toBeInTheDocument();
    expect(screen.getByTestId('generation-status')).toHaveTextContent('Skipped — no new messages');
    expect(screen.getByTestId('delivery-status')).toHaveTextContent('Not sent');
    expect(screen.queryByRole('button', { name: 'Copy digest' })).not.toBeInTheDocument();
    const timeline = screen.getByRole('heading', { name: 'Delivery timeline' }).closest('section');
    if (timeline === null) throw new Error('Expected delivery timeline');
    expect(within(timeline).getByText('No activity — generation not needed')).toBeInTheDocument();
    expect(within(timeline).getByText('WhatsApp delivery was not needed')).toBeInTheDocument();
    expect(timeline).not.toHaveTextContent('Waiting for summary content');
    expect(timeline).not.toHaveTextContent('No confirmed provider receipt');
  });

  it('maps a foreign or missing run to the same owner-safe not-found state', () => {
    mocks.useMessageDigestRun.mockReturnValue(
      runResult({ run: null, isInitialLoading: false, isNotFound: true })
    );
    renderRun('/whatsapp/message-digests/digest-a/history/private-run-id');

    expect(
      screen.getByRole('heading', { name: 'Message Digest run not found' })
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('private-run-id');
    expect(screen.getByRole('link', { name: 'Back to history' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a/history'
    );
  });
});

function renderHistory(
  initialPath = '/whatsapp/message-digests/digest-a/history',
  state?: Record<string, unknown>
): ReturnType<typeof render> {
  return render(historyTree(initialPath, state));
}

function historyTree(
  initialPath = '/whatsapp/message-digests/digest-a/history',
  state?: Record<string, unknown>
): React.JSX.Element {
  return (
    <MemoryRouter initialEntries={[state === undefined ? initialPath : { pathname: initialPath, state }]}>
      <LocationSearchProbe />
      <Routes>
        <Route
          path="/whatsapp/message-digests/:definitionId/history"
          element={<WhatsAppMessageDigestHistoryPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderRun(
  initialPath = '/whatsapp/message-digests/digest-a/history/run-a',
  state?: Record<string, unknown>
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[state === undefined ? initialPath : { pathname: initialPath, state }]}>
      <Routes>
        <Route
          path="/whatsapp/message-digests/:definitionId/history/:runId"
          element={<WhatsAppMessageDigestRunPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function LocationSearchProbe(): React.JSX.Element {
  const location = useLocation();
  return <span data-testid="search-probe">{location.search.replace(/^\?/u, '')}</span>;
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

function historyResult(
  overrides: Partial<UseMessageDigestHistoryResult> = {}
): UseMessageDigestHistoryResult {
  return {
    items: [run('run-a', 'completed', 'sent'), run('run-b', 'completed', 'sent')],
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

function runResult(overrides: Partial<UseMessageDigestRunResult> = {}): UseMessageDigestRunResult {
  return {
    run: run('run-a', 'completed', 'sent'),
    isInitialLoading: false,
    isPolling: false,
    isNotFound: false,
    error: null,
    pollError: null,
    refresh: mocks.runRefresh,
    retryStage: null,
    isRetrying: false,
    retryError: null,
    retryRun: mocks.retryRun,
    clearRetryError: mocks.clearRetryError,
    ...overrides,
  };
}

function definition(): MessageDigestDefinition {
  return {
    id: 'digest-a',
    name: 'Daily fishing brief',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
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

function run(
  id: string,
  generationStatus: MessageDigestGenerationStatus,
  deliveryStatus: MessageDigestDeliveryStatus
): MessageDigestRun {
  const completed = generationStatus === 'completed';
  const skipped = generationStatus === 'skipped_no_activity';
  const failed = generationStatus === 'failed';
  const processing = generationStatus === 'processing';
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
    generationStatus,
    processingStage: processing
      ? 'aggregating'
      : failed
        ? 'failed'
        : skipped
          ? 'skipped_no_activity'
          : generationStatus === 'queued'
            ? 'queued'
            : 'completed',
    attempts: 1,
    source: { chatType: 'group', displayName: 'Fishing group' },
    instructions: { ...definition().instructions, revision: 'instructions-v1' },
    schedule: definition().schedule,
    content: completed
      ? {
          headline: 'Today on the water',
          summaryMarkdown: '**Two plans** were agreed.\n\n<script>private()</script>',
          evidenceMessageRefs: ['private-message-ref'],
        }
      : null,
    effectiveMessageCount: processing ? null : skipped ? 0 : 17,
    promptVersion: completed ? 'message-digest-v1' : null,
    model: completed ? LlmModels.Gemini25Flash : null,
    usage: completed ? { inputTokens: 100, outputTokens: 20, totalTokens: 120 } : null,
    delivery: {
      type: 'whatsapp_primary',
      status: deliveryStatus,
      acceptedAt: deliveryStatus === 'sent' ? '2026-07-27T05:31:00.000Z' : null,
      failedAt: deliveryStatus === 'failed' ? '2026-07-27T05:31:00.000Z' : null,
      failureCode: deliveryStatus === 'failed' ? 'provider_rejected' : null,
    },
    safeFailureCode: failed ? 'generation_failed' : null,
    createdAt: '2026-07-27T05:30:00.000Z',
    updatedAt: '2026-07-27T05:31:00.000Z',
    completedAt: processing ? null : '2026-07-27T05:30:30.000Z',
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      resolvePromise?.(value);
    },
  };
}
