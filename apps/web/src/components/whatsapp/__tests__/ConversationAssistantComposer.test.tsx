/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationAssistantAttachmentState } from '@/utils/conversationAssistantAttachmentState';
import {
  ConversationAssistantComposer,
  type ConversationAssistantComposerProps,
} from '../ConversationAssistantComposer.js';

afterEach(cleanup);

const readyAttachment = {
  id: 'attachment-1',
  sessionId: 'session-1',
  status: 'ready' as const,
  compatibility: 'current' as const,
  capturedAt: '2026-07-21T10:00:00.000Z',
  expiresAt: '2026-07-21T10:30:00.000Z',
  captureRange: {
    from: '2026-07-20T10:00:00.000Z',
    to: '2026-07-21T10:00:00.000Z',
  },
  counts: {
    included: 2,
    excluded: 1,
    newlyAvailable: 2,
    edited: 0,
    redacted: 0,
    deleted: 0,
    reactionsChanged: 0,
    lateIngested: 0,
    completedTranscriptions: 0,
  },
  omitted: {
    mediaOnly: 1,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  },
  requiresConfirmation: false,
  newerAvailableCount: 0,
  newerAvailableCorrectionCount: 0,
};

type ComposerHarnessProps = Omit<ConversationAssistantComposerProps, 'value' | 'onChange'>;

function createProps(overrides: Partial<ComposerHarnessProps> = {}): ComposerHarnessProps {
  return {
    disabled: false,
    turnPhase: 'idle' as const,
    mode: 'follow-up' as const,
    attachmentState: { phase: 'idle', sessionId: 'session-1' } as ConversationAssistantAttachmentState,
    attachmentRequestPhase: 'idle' as const,
    warningAcknowledged: false,
    continuationState: 'available' as const,
    displayTimeZone: 'Europe/Warsaw',
    onSend: vi.fn().mockResolvedValue(undefined),
    onInclude: vi.fn().mockResolvedValue(undefined),
    onViewAttachment: vi.fn(),
    onRemoveAttachment: vi.fn().mockResolvedValue(undefined),
    onRetryAttachment: vi.fn().mockResolvedValue(undefined),
    onRefreshAttachment: vi.fn().mockResolvedValue(undefined),
    onKeepCurrentAttachment: vi.fn(),
    onAcknowledgeWarning: vi.fn(),
    onStartNewAnalysis: vi.fn(),
    ...overrides,
  };
}

function ComposerHarness({ props }: { props: ReturnType<typeof createProps> }): React.JSX.Element {
  const [value, setValue] = useState('Draft question');
  return <ConversationAssistantComposer {...props} value={value} onChange={setValue} />;
}

describe('ConversationAssistantComposer', () => {
  it('keeps the full Include action and returns pointer focus to the editable question', async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<ComposerHarness props={props} />);

    const textarea = screen.getByLabelText('Ask follow-up');
    const include = screen.getByRole('button', { name: 'Include new messages' });
    expect(include).toHaveClass('min-h-11');
    expect(screen.getByText('Send')).not.toHaveClass('sr-only');

    await user.click(include);
    expect(props.onInclude).toHaveBeenCalledTimes(1);
    expect(textarea).toHaveFocus();

    include.focus();
    await user.keyboard('{Enter}');
    expect(props.onInclude).toHaveBeenCalledTimes(2);
    expect(include).toHaveFocus();
  });

  it('inserts a newline with Enter and sends only with Ctrl+Enter or Cmd+Enter', async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<ComposerHarness props={props} />);
    const textarea = screen.getByLabelText('Ask follow-up');

    await user.click(textarea);
    await user.keyboard('{End}{Enter}Second line');
    expect(textarea).toHaveValue('Draft question\nSecond line');
    expect(props.onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(props.onSend).toHaveBeenCalledTimes(2);
  });

  it('keeps writing enabled while preparation blocks both Include and Send', () => {
    const props = createProps({
      attachmentState: {
        phase: 'preparing',
        sessionId: 'session-1',
        attachment: { ...readyAttachment, status: 'preparing' },
      } satisfies ConversationAssistantAttachmentState,
    });
    render(<ComposerHarness props={props} />);

    expect(screen.getByLabelText('Ask follow-up')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Include new messages' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('group', { name: 'WhatsApp context update' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(screen.getByTestId('conversation-assistant-composer')).toHaveClass(
      'min-w-0',
      'overflow-x-hidden',
      'pb-[max(0.75rem,env(safe-area-inset-bottom))]'
    );
  });

  it.each([
    ['include', 'Freezing WhatsApp messages…'],
    ['refresh', 'Refreshing WhatsApp context…'],
  ] as const)('immediately blocks send during the %s network boundary', (phase, status) => {
    const props = createProps({ attachmentRequestPhase: phase });
    render(<ComposerHarness props={props} />);

    expect(screen.getByLabelText('Ask follow-up')).toBeEnabled();
    expect(screen.getByRole('button', { name: /messages/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(status);
  });

  it('blocks editing during restoration and explains unsupported continuation states', () => {
    const { rerender } = render(
      <ComposerHarness
        props={createProps({
          attachmentState: {
            phase: 'restoring',
            sessionId: 'session-1',
            attachmentId: 'attachment-1',
          } satisfies ConversationAssistantAttachmentState,
        })}
      />
    );
    expect(screen.getByLabelText('Ask follow-up')).toBeDisabled();
    expect(screen.getByText('Restoring your question and attachment…')).toBeInTheDocument();

    rerender(
      <ComposerHarness
        props={createProps({ continuationState: 'legacy_session' as const })}
      />
    );
    expect(
      screen.getByText('This older analysis cannot reliably include later WhatsApp context.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Start a new analysis (opens in a new tab)' })
    ).toBeEnabled();

    rerender(
      <ComposerHarness
        props={createProps({ continuationState: 'source_unavailable' as const })}
      />
    );
    expect(
      screen.getByText('The source WhatsApp conversation is no longer available.')
    ).toBeInTheDocument();
  });

  it('keeps source loss visible while preserving safe frozen-snapshot actions only', () => {
    const actions = createProps({
      continuationState: 'source_unavailable',
      attachmentState: {
        phase: 'ready',
        sessionId: 'session-1',
        attachment: readyAttachment,
      },
    });
    const view = render(<ComposerHarness props={actions} />);

    expect(
      screen.getByText('The source WhatsApp conversation is no longer available.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Include new messages' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();

    view.rerender(
      <ComposerHarness
        props={createProps({
          continuationState: 'source_unavailable',
          attachmentState: {
            phase: 'newer_available',
            sessionId: 'session-1',
            attachment: {
              ...readyAttachment,
              newerAvailableCount: 2,
            },
          },
        })}
      />
    );
    expect(screen.getByRole('button', { name: 'Refresh attachment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep current snapshot' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();

    view.rerender(
      <ComposerHarness
        props={createProps({
          continuationState: 'source_unavailable',
          attachmentState: {
            phase: 'expired',
            sessionId: 'session-1',
            attachment: { ...readyAttachment, status: 'expired' },
          },
        })}
      />
    );
    expect(screen.getByRole('button', { name: 'Capture again' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
  });

  it('returns focus to Include after a removable draft is removed', async () => {
    const user = userEvent.setup();
    const props = createProps({
      attachmentState: {
        phase: 'ready',
        sessionId: 'session-1',
        attachment: readyAttachment,
      } satisfies ConversationAssistantAttachmentState,
    });
    const view = render(<ComposerHarness props={props} />);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(props.onRemoveAttachment).toHaveBeenCalledTimes(1);

    view.rerender(<ComposerHarness props={createProps()} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Include new messages' })).toHaveFocus();
    });
  });
});
