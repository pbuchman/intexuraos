/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationAssistantContextAttachmentCard } from '../ConversationAssistantContextAttachmentCard.js';
import type {
  ConversationAssistantAttachmentDto,
  ConversationAssistantAttachmentState,
} from '@/utils/conversationAssistantAttachmentState';

const attachment: ConversationAssistantAttachmentDto = {
  id: 'attachment-1',
  sessionId: 'session-1',
  status: 'ready',
  compatibility: 'current',
  capturedAt: '2026-07-19T10:14:00.000Z',
  expiresAt: '2026-07-19T10:44:00.000Z',
  captureRange: {
    from: '2026-07-17T18:42:00.000Z',
    to: '2026-07-19T10:14:00.000Z',
  },
  eventRange: {
    from: '2026-07-17T18:49:00.000Z',
    to: '2026-07-19T10:09:00.000Z',
  },
  counts: {
    included: 18,
    excluded: 2,
    edited: 2,
    redacted: 3,
    reactionsChanged: 3,
    lateIngested: 1,
    completedTranscriptions: 1,
  },
  omitted: {
    mediaOnly: 1,
    failedTranscriptions: 0,
    pendingTranscriptions: 1,
    nonText: 0,
    overLimit: 0,
  },
  requiresConfirmation: false,
  newerAvailableCount: 0,
  newerAvailableCorrectionCount: 0,
};

function callbacks(): {
  onViewMessages: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onKeepCurrent: () => void;
  onAcknowledgeWarning: () => void;
  onStartNewAnalysis: () => void;
} {
  return {
    onViewMessages: vi.fn(),
    onRemove: vi.fn(),
    onRetry: vi.fn(),
    onRefresh: vi.fn(),
    onKeepCurrent: vi.fn(),
    onAcknowledgeWarning: vi.fn(),
    onStartNewAnalysis: vi.fn(),
  };
}

function state(
  phase: Exclude<ConversationAssistantAttachmentState['phase'], 'idle' | 'restoring'>,
  value: ConversationAssistantAttachmentDto = attachment
): ConversationAssistantAttachmentState {
  if (phase === 'failed') {
    return {
      phase,
      sessionId: value.sessionId,
      attachment: value,
      failure: {
        code: 'ATTACHMENT_PREPARATION_FAILED',
        message: 'The context attachment could not be prepared',
        blocking: false,
      },
    };
  }
  return { phase, sessionId: value.sessionId, attachment: value };
}

afterEach(cleanup);

describe('ConversationAssistantContextAttachmentCard', () => {
  it('shows a busy, removable preparation without hiding its plain-language purpose', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(
      <ConversationAssistantContextAttachmentCard
        state={state('preparing', { ...attachment, status: 'preparing' })}
        warningAcknowledged={false}
        {...actions}
      />
    );

    const group = screen.getByRole('group', { name: 'WhatsApp context update' });
    expect(group).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Preparing this update…')).toBeInTheDocument();
    expect(
      screen.getByText('You can keep writing while messages are prepared.')
    ).toBeInTheDocument();
    const remove = screen.getByRole('button', { name: 'Remove' });
    expect(remove).toHaveClass('min-h-11');
    await user.click(remove);
    expect(actions.onRemove).toHaveBeenCalledOnce();
  });

  it('presents ready counts, chronological message range, and immutable capture cutoff', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(
      <ConversationAssistantContextAttachmentCard
        state={state('ready', {
          ...attachment,
          counts: { ...attachment.counts, deleted: 2 },
        })}
        displayTimeZone="Europe/Warsaw"
        warningAcknowledged={false}
        {...actions}
      />
    );

    expect(screen.getByText('18 included · 2 excluded')).toBeInTheDocument();
    expect(screen.getByText('9 updates to earlier context')).toBeInTheDocument();
    expect(screen.getByText(/1 completed transcription/)).toBeInTheDocument();
    expect(screen.getByText(/2 edits/)).toBeInTheDocument();
    expect(screen.getByText(/3 redactions/)).toBeInTheDocument();
    expect(screen.queryByText(/deletion/)).not.toBeInTheDocument();
    expect(screen.getByText(/3 reaction changes/)).toBeInTheDocument();
    expect(screen.getByText(/^Messages:/).closest('dd')).toHaveTextContent('Jul 17');
    expect(screen.getByText(/^Snapshot captured:/).closest('dd')).toHaveTextContent('Jul 19');
    const omitted = screen.getByText(
      'Omitted: 1 media item without usable text · 1 transcription not ready'
    );
    const captured = screen.getByText(/^Snapshot captured:/).closest('dd');
    expect(
      captured?.compareDocumentPosition(omitted) ?? Node.DOCUMENT_POSITION_PRECEDING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText(/^Messages:/).closest('div')?.querySelector('time')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/July 17, 2026.*Europe\/Warsaw/)
    );
    expect(screen.getByRole('status')).toHaveTextContent('WhatsApp context update is ready.');
    await user.click(screen.getByRole('button', { name: 'View messages' }));
    expect(actions.onViewMessages).toHaveBeenCalledOnce();
  });

  it('describes zero-message and corrections-only snapshots without calling them empty', () => {
    render(
      <ConversationAssistantContextAttachmentCard
        state={state('ready', {
          ...attachment,
          eventRange: undefined,
          counts: {
            ...attachment.counts,
            included: 0,
            excluded: 2,
            newlyAvailable: 0,
            completedTranscriptions: 1,
            edited: 2,
            redacted: 0,
            reactionsChanged: 0,
            lateIngested: 0,
          },
        })}
        warningAcknowledged={false}
        {...callbacks()}
      />
    );

    expect(screen.getByText('No new messages · 3 updates to earlier context')).toBeInTheDocument();
    expect(screen.getByText('2 excluded')).toBeInTheDocument();
    expect(
      screen.getByText('Omitted: 1 media item without usable text · 1 transcription not ready')
    ).toBeInTheDocument();
    expect(screen.getByText(/^Checked:/)).toBeInTheDocument();
    expect(screen.queryByText(/empty/i)).not.toBeInTheDocument();
  });

  it('requires explicit continuation for a large ready snapshot', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(
      <ConversationAssistantContextAttachmentCard
        state={state('ready', {
          ...attachment,
          counts: { ...attachment.counts, included: 5432 },
          requiresConfirmation: true,
        })}
        warningAcknowledged={false}
        {...actions}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This update contains 5,432 messages. It may take longer and could fail.'
    );
    await user.click(screen.getByRole('button', { name: 'Continue with this snapshot' }));
    expect(actions.onAcknowledgeWarning).toHaveBeenCalledOnce();
  });

  it('keeps a frozen snapshot sendable while clearly separating newer content actions', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(
      <ConversationAssistantContextAttachmentCard
        state={state('newer_available', {
          ...attachment,
          newerAvailableCount: 3,
          newerAvailableCorrectionCount: 1,
        })}
        warningAcknowledged={false}
        {...actions}
      />
    );

    expect(
      screen.getAllByText('3 newer messages and 1 newer update arrived after this snapshot.')
    ).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent(
      '3 newer messages and 1 newer update arrived after this snapshot.'
    );
    await user.click(screen.getByRole('button', { name: 'Refresh attachment' }));
    await user.click(screen.getByRole('button', { name: 'Keep current snapshot' }));
    expect(actions.onRefresh).toHaveBeenCalledOnce();
    expect(actions.onKeepCurrent).toHaveBeenCalledOnce();
  });

  it('offers retry and remove after a preparation failure', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(
      <ConversationAssistantContextAttachmentCard
        state={state('failed')}
        warningAcknowledged={false}
        {...actions}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The context attachment could not be prepared'
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(actions.onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('does not invent zero counts when failed attachment metadata is unavailable', () => {
    render(
      <ConversationAssistantContextAttachmentCard
        state={state('failed', {
          ...attachment,
          status: 'failed',
          counts: undefined,
          omitted: undefined,
          captureRange: undefined,
          eventRange: undefined,
        })}
        warningAcknowledged={false}
        {...callbacks()}
      />
    );

    expect(screen.queryByText('0 included · 0 excluded')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The context attachment could not be prepared'
    );
  });

  it.each(['CONTEXT_WINDOW_EXCEEDED', 'ATTACHMENT_TOO_LARGE'] as const)(
    'shows only safe recovery actions after a %s rejection',
    (code) => {
      const hardLimitState: ConversationAssistantAttachmentState = {
        phase: 'failed',
        sessionId: attachment.sessionId,
        attachment,
        failure: {
          code,
          message: 'This update is too large to include in one question.',
          blocking: true,
        },
      };
      render(
        <ConversationAssistantContextAttachmentCard
          state={hardLimitState}
          warningAcknowledged={false}
          {...callbacks()}
        />
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        'This update is too large to include in one question. Your question remains here.'
      );
      expect(screen.getByRole('button', { name: 'Remove attachment' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Start a new analysis (opens in a new tab)' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    }
  );

  it.each([
    ['expired', 'This attachment expired before it was sent. Your question is safe.'],
    ['stale', 'This analysis was updated in another tab. Your question is safe.'],
  ] as const)('guides recovery from %s without losing the question', (phase, copy) => {
    render(
      <ConversationAssistantContextAttachmentCard
        state={state(phase)}
        warningAcknowledged={false}
        {...callbacks()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(copy);
    expect(screen.getByRole('button', { name: 'Capture again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('offers only a local continuation after another tab consumed the attachment', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(
      <ConversationAssistantContextAttachmentCard
        state={
          {
            phase: 'consumed_elsewhere',
            sessionId: attachment.sessionId,
            attachment: { ...attachment, status: 'committed' },
          } as unknown as ConversationAssistantAttachmentState
        }
        warningAcknowledged={false}
        {...actions}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This update was already used in another tab. Your question is safe.'
    );
    expect(screen.queryByRole('button', { name: 'Capture again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue without this update' }));
    expect(actions.onRemove).toHaveBeenCalledOnce();
  });

  it('offers a local discard when a restored attachment no longer exists', async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(
      <ConversationAssistantContextAttachmentCard
        state={
          {
            phase: 'missing',
            sessionId: attachment.sessionId,
            attachmentId: attachment.id,
          } as unknown as ConversationAssistantAttachmentState
        }
        warningAcknowledged={false}
        {...actions}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This saved WhatsApp context update is no longer available. Your question is safe.'
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard missing update' }));
    expect(actions.onRemove).toHaveBeenCalledOnce();
  });

  it('requires a fresh capture when prepared metadata no longer matches sendability', () => {
    render(
      <ConversationAssistantContextAttachmentCard
        state={
          {
            phase: 'recapture_required',
            sessionId: attachment.sessionId,
            attachment,
          } as unknown as ConversationAssistantAttachmentState
        }
        warningAcknowledged={false}
        {...callbacks()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This update could not be attached. Capture it again before sending. Your question is safe.'
    );
    expect(screen.getByRole('button', { name: 'Capture again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('announces restoration and renders nothing for an idle composer', () => {
    const { rerender } = render(
      <ConversationAssistantContextAttachmentCard
        state={{ phase: 'restoring', sessionId: 'session-1', attachmentId: 'attachment-1' }}
        warningAcknowledged={false}
        {...callbacks()}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Restoring your question and attachment…');
    expect(
      screen.queryByText('This update was already used in another tab. Your question is safe.')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Continue without this update' })
    ).not.toBeInTheDocument();
    rerender(
      <ConversationAssistantContextAttachmentCard
        state={{ phase: 'idle', sessionId: 'session-1' }}
        warningAcknowledged={false}
        {...callbacks()}
      />
    );
    expect(
      screen.queryByRole('group', { name: 'WhatsApp context update' })
    ).not.toBeInTheDocument();
  });
});
