/**
 * @vitest-environment jsdom
 */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ConversationAssistantContextAttachmentPreviewResponse,
  ConversationAssistantContextHistoryResponse,
} from '@/types';
import { ConversationAssistantContextViewerModal } from '../ConversationAssistantContextViewerModal.js';

afterEach(cleanup);

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const history: ConversationAssistantContextHistoryResponse = {
  snapshots: [
    {
      kind: 'initial',
      contextVersion: 0,
      capturedAt: '2026-07-20T10:00:00.000Z',
      messageCount: 9,
      excludedCount: 2,
      correctionCount: 0,
      omitted: {
        mediaOnly: 2,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 0,
        overLimit: 0,
      },
    },
    {
      kind: 'update',
      contextVersion: 1,
      capturedAt: '2026-07-21T10:00:00.000Z',
      messageCount: 2,
      excludedCount: 1,
      correctionCount: 0,
      omitted: {
        mediaOnly: 0,
        failedTranscriptions: 0,
        pendingTranscriptions: 1,
        nonText: 0,
        overLimit: 0,
      },
      attachmentId: 'attachment-1',
      linkedTurnId: 'turn-user',
      captureRange: {
        from: '2026-07-20T10:00:00.000Z',
        to: '2026-07-21T10:00:00.000Z',
      },
      eventRange: {
        from: '2026-07-21T08:00:00.000Z',
        to: '2026-07-21T09:30:00.000Z',
      },
    },
  ],
};

const firstPreview: ConversationAssistantContextAttachmentPreviewResponse = {
  items: [
    {
      kind: 'included',
      message: {
        id: 'message-1',
        eventTimestamp: '2026-07-21T08:00:00.000Z',
        importedAt: '2026-07-21T08:00:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Contact',
        messageType: 'text',
        contentKind: 'text',
        content: 'A newly attached message.',
      },
    },
    {
      kind: 'excluded',
      message: {
        id: 'message-2',
        eventTimestamp: '2026-07-21T08:05:00.000Z',
        importedAt: '2026-07-21T08:05:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Contact',
        messageType: 'audio',
        omissionReason: 'pending_transcription',
      },
    },
    {
      kind: 'correction',
      changeKind: 'edited',
      targetReference: 'message-old',
      before: {
        state: 'included',
        eventTimestamp: '2026-07-20T09:00:00.000Z',
        importedAt: '2026-07-20T09:00:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Contact',
        messageType: 'text',
        contentKind: 'text',
        content: 'Earlier wording.',
        reactions: [],
      },
      after: {
        state: 'included',
        eventTimestamp: '2026-07-20T09:00:00.000Z',
        importedAt: '2026-07-21T08:10:00.000Z',
        direction: 'incoming',
        speakerLabel: 'Contact',
        messageType: 'text',
        contentKind: 'text',
        content: 'Corrected wording.',
        reactions: [],
      },
    },
  ],
  nextCursor: 'next-page',
};

describe('ConversationAssistantContextViewerModal', () => {
  it('lists immutable history in order and opens the selected update preview', async () => {
    const user = userEvent.setup();
    const loadHistory = vi.fn<() => Promise<ConversationAssistantContextHistoryResponse | null>>()
      .mockResolvedValue(history);
    const loadPreview = vi
      .fn<(attachmentId: string, cursor?: string) => Promise<ConversationAssistantContextAttachmentPreviewResponse | null>>()
      .mockResolvedValueOnce(firstPreview)
      .mockResolvedValueOnce({
        items: [
          {
            kind: 'included',
            message: {
              id: 'message-3',
              eventTimestamp: '2026-07-21T09:00:00.000Z',
              importedAt: '2026-07-21T09:00:01.000Z',
              direction: 'outgoing',
              speakerLabel: 'You',
              messageType: 'text',
              contentKind: 'text',
              content: 'Next preview page.',
            },
          },
        ],
      });
    const onJumpToTurn = vi.fn();
    render(
      <ConversationAssistantContextViewerModal
        mode={{ kind: 'history' }}
        loadHistory={loadHistory}
        loadPreview={loadPreview}
        onViewInitial={vi.fn()}
        onJumpToTurn={onJumpToTurn}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByRole('heading', { name: 'Conversation context' })).toBeInTheDocument();
    const initial = screen.getByText('Initial snapshot');
    const update = screen.getByText('Update 1');
    expect(initial.compareDocumentPosition(update) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    await user.click(screen.getByRole('button', { name: 'View messages from update 1' }));
    expect(loadPreview).toHaveBeenCalledWith('attachment-1', undefined);
    expect(await screen.findByText('A newly attached message.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to context history' })).toHaveFocus();
    expect(screen.getAllByText('A newly attached message.')).toHaveLength(1);
    expect(screen.getByText('Transcription not ready')).toBeInTheDocument();
    expect(screen.getByText('Edited earlier context')).toBeInTheDocument();
    expect(screen.getByText('Earlier wording.')).toBeInTheDocument();
    expect(screen.getByText('Corrected wording.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more messages' }));
    expect(loadPreview).toHaveBeenLastCalledWith('attachment-1', 'next-page');
    expect(await screen.findByText('Next preview page.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to context history' }));
    expect(screen.getByRole('button', { name: 'View messages from update 1' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Go to question for update 1' }));
    expect(onJumpToTurn).toHaveBeenCalledWith('turn-user');
  });

  it('ignores a late preview failure after Back and restores the history trigger focus', async () => {
    const user = userEvent.setup();
    const preview = createDeferred<ConversationAssistantContextAttachmentPreviewResponse | null>();
    render(
      <ConversationAssistantContextViewerModal
        mode={{ kind: 'history' }}
        loadHistory={vi.fn().mockResolvedValue(history)}
        loadPreview={vi.fn().mockReturnValue(preview.promise)}
        onViewInitial={vi.fn()}
        onJumpToTurn={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const updateTrigger = await screen.findByRole('button', {
      name: 'View messages from update 1',
    });
    await user.click(updateTrigger);
    await user.click(screen.getByRole('button', { name: 'Back to context history' }));

    expect(screen.getByText('Update 1')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View messages from update 1' })
    ).toHaveFocus();

    await act(async () => {
      preview.resolve(null);
      await preview.promise;
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Update 1')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View messages from update 1' })
    ).toHaveFocus();
  });

  it('keeps corrections-only history ranges and omission reasons auditable', async () => {
    const initialSnapshot = history.snapshots[0];
    if (initialSnapshot === undefined) throw new Error('Expected initial history fixture');
    const correctionsOnlyHistory: ConversationAssistantContextHistoryResponse = {
      snapshots: [
        initialSnapshot,
        {
          kind: 'update',
          contextVersion: 1,
          capturedAt: '2026-07-21T10:00:00.000Z',
          messageCount: 0,
          excludedCount: 2,
          correctionCount: 3,
          omitted: {
            mediaOnly: 1,
            failedTranscriptions: 0,
            pendingTranscriptions: 1,
            nonText: 0,
            overLimit: 0,
          },
          attachmentId: 'attachment-corrections-only',
          linkedTurnId: 'turn-corrections-only',
          captureRange: {
            from: '2026-07-20T10:00:00.000Z',
            to: '2026-07-21T10:00:00.000Z',
          },
        },
      ],
    };
    render(
      <ConversationAssistantContextViewerModal
        mode={{ kind: 'history' }}
        loadHistory={vi.fn().mockResolvedValue(correctionsOnlyHistory)}
        loadPreview={vi.fn()}
        onViewInitial={vi.fn()}
        onJumpToTurn={vi.fn()}
        onClose={vi.fn()}
        displayTimeZone="Europe/Warsaw"
      />
    );

    expect(
      await screen.findByText('No new messages · 3 updates to earlier context')
    ).toBeInTheDocument();
    expect(screen.getByText('2 excluded')).toBeInTheDocument();
    expect(
      screen.getByText('Omitted: 1 media item without usable text · 1 transcription not ready')
    ).toBeInTheDocument();
    expect(screen.getByText(/^Checked:/)).toBeInTheDocument();
    expect(screen.queryByText(/^Messages:/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Checked:/).closest('div')?.querySelector('time')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/July 20, 2026.*Europe\/Warsaw/)
    );
    expect(screen.getAllByText(/^Captured /)[0]).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/July 20, 2026.*Europe\/Warsaw/)
    );
  });

  it('opens a timeline attachment directly, closes on Escape, and uses a mobile-safe sheet', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const loadPreview = vi.fn().mockResolvedValue({ items: [] });
    render(
      <ConversationAssistantContextViewerModal
        mode={{ kind: 'attachment', attachmentId: 'attachment-1' }}
        loadHistory={vi.fn()}
        loadPreview={loadPreview}
        onViewInitial={vi.fn()}
        onJumpToTurn={vi.fn()}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(loadPreview).toHaveBeenCalledWith('attachment-1', undefined);
    });
    expect(screen.getByRole('dialog')).toHaveClass(
      'bottom-0',
      'max-h-[calc(100dvh-env(safe-area-inset-top))]',
      'sm:bottom-auto'
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps initial-context pagination reachable from history', async () => {
    const user = userEvent.setup();
    const onViewInitial = vi.fn();
    render(
      <ConversationAssistantContextViewerModal
        mode={{ kind: 'history' }}
        loadHistory={vi.fn().mockResolvedValue(history)}
        loadPreview={vi.fn()}
        onViewInitial={onViewInitial}
        onJumpToTurn={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await user.click(await screen.findByRole('button', { name: 'View initial snapshot messages' }));
    expect(onViewInitial).toHaveBeenCalledTimes(1);
  });

  it('renders reaction changes in safe before and after projections', async () => {
    const reactionPreview: ConversationAssistantContextAttachmentPreviewResponse = {
      items: [
        {
          kind: 'correction',
          changeKind: 'reaction_changed',
          targetReference: 'message-old',
          before: {
            state: 'included',
            eventTimestamp: '2026-07-20T09:00:00.000Z',
            importedAt: '2026-07-20T09:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Contact',
            messageType: 'text',
            contentKind: 'text',
            content: 'Same message text.',
            reactions: [
              {
                emoji: '👍',
                senderDisplayName: 'Contact',
                direction: 'incoming',
                eventTimestamp: '2026-07-20T09:01:00.000Z',
              },
            ],
          },
          after: {
            state: 'included',
            eventTimestamp: '2026-07-20T09:00:00.000Z',
            importedAt: '2026-07-21T08:10:00.000Z',
            direction: 'incoming',
            speakerLabel: 'Contact',
            messageType: 'text',
            contentKind: 'text',
            content: 'Same message text.',
            reactions: [
              {
                emoji: '❤️',
                senderDisplayName: 'You',
                direction: 'outgoing',
                eventTimestamp: '2026-07-21T08:09:00.000Z',
              },
            ],
          },
        },
      ],
    };
    render(
      <ConversationAssistantContextViewerModal
        mode={{ kind: 'attachment', attachmentId: 'attachment-reactions' }}
        loadHistory={vi.fn()}
        loadPreview={vi.fn().mockResolvedValue(reactionPreview)}
        onViewInitial={vi.fn()}
        onJumpToTurn={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText('Changed reactions in earlier context')).toBeInTheDocument();
    expect(screen.getByLabelText('Before reactions')).toHaveTextContent('👍 Contact');
    expect(screen.getByLabelText('After reactions')).toHaveTextContent('❤️ You');
  });

  it('presents legacy deleted corrections only as redactions', async () => {
    const legacyPreview = {
      items: [
        {
          kind: 'correction',
          changeKind: 'deleted',
          targetReference: 'message-old',
          before: {
            state: 'included',
            eventTimestamp: '2026-07-20T09:00:00.000Z',
            importedAt: '2026-07-20T09:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Contact',
            messageType: 'text',
            contentKind: 'text',
            content: 'Earlier content.',
            reactions: [],
          },
          after: {
            state: 'deleted',
            eventTimestamp: '2026-07-20T09:00:00.000Z',
            importedAt: '2026-07-21T08:10:00.000Z',
            direction: 'incoming',
            speakerLabel: 'Contact',
            messageType: 'text',
            reactions: [],
          },
        },
      ],
    } as unknown as ConversationAssistantContextAttachmentPreviewResponse;
    render(
      <ConversationAssistantContextViewerModal
        mode={{ kind: 'attachment', attachmentId: 'attachment-legacy-deleted' }}
        loadHistory={vi.fn()}
        loadPreview={vi.fn().mockResolvedValue(legacyPreview)}
        onViewInitial={vi.fn()}
        onJumpToTurn={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText('Redacted earlier context')).toBeInTheDocument();
    expect(screen.getByText('Content redacted')).toBeInTheDocument();
    expect(screen.queryByText(/deleted/i)).not.toBeInTheDocument();
  });

  it('renders safe reactions for ordinary included and excluded preview messages', async () => {
    const reactionPreview: ConversationAssistantContextAttachmentPreviewResponse = {
      items: [
        {
          kind: 'included',
          message: {
            id: 'included-with-reaction',
            eventTimestamp: '2026-07-21T08:00:00.000Z',
            importedAt: '2026-07-21T08:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Contact',
            messageType: 'text',
            contentKind: 'text',
            content: 'A message with a reaction.',
            reactions: [
              {
                emoji: '🔥',
                direction: 'outgoing',
                senderDisplayName: 'Private sender name must not replace You',
                eventTimestamp: '2026-07-21T08:01:00.000Z',
              },
            ],
          },
        },
        {
          kind: 'excluded',
          message: {
            id: 'excluded-with-reaction',
            eventTimestamp: '2026-07-21T08:05:00.000Z',
            importedAt: '2026-07-21T08:05:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Contact',
            messageType: 'audio',
            omissionReason: 'media_only',
            reactions: [
              {
                emoji: '👍',
                direction: 'incoming',
                eventTimestamp: '2026-07-21T08:06:00.000Z',
              },
            ],
          },
        },
      ],
    };
    render(
      <ConversationAssistantContextViewerModal
        mode={{ kind: 'attachment', attachmentId: 'attachment-message-reactions' }}
        loadHistory={vi.fn()}
        loadPreview={vi.fn().mockResolvedValue(reactionPreview)}
        onViewInitial={vi.fn()}
        onJumpToTurn={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText('A message with a reaction.')).toBeInTheDocument();
    const reactionLists = screen.getAllByLabelText('Message reactions');
    expect(reactionLists).toHaveLength(2);
    expect(reactionLists[0]).toHaveTextContent('🔥 You');
    expect(reactionLists[0]).not.toHaveTextContent('Private sender name');
    expect(reactionLists[1]).toHaveTextContent('👍 Contact');
  });

  it('ignores an older preview response after the requested attachment changes', async () => {
    const stale = createDeferred<ConversationAssistantContextAttachmentPreviewResponse | null>();
    const loadPreview = vi
      .fn<
        (
          attachmentId: string,
          cursor?: string
        ) => Promise<ConversationAssistantContextAttachmentPreviewResponse | null>
      >()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({
        items: [
          {
            kind: 'included',
            message: {
              id: 'message-current',
              eventTimestamp: '2026-07-21T09:00:00.000Z',
              importedAt: '2026-07-21T09:00:01.000Z',
              direction: 'incoming',
              speakerLabel: 'Contact',
              messageType: 'text',
              contentKind: 'text',
              content: 'Current attachment preview.',
            },
          },
        ],
      });
    const view = render(
      <ConversationAssistantContextViewerModal
        mode={{ kind: 'attachment', attachmentId: 'attachment-old' }}
        loadHistory={vi.fn()}
        loadPreview={loadPreview}
        onViewInitial={vi.fn()}
        onJumpToTurn={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(loadPreview).toHaveBeenCalledWith('attachment-old', undefined);
    });
    view.rerender(
      <ConversationAssistantContextViewerModal
        mode={{ kind: 'attachment', attachmentId: 'attachment-current' }}
        loadHistory={vi.fn()}
        loadPreview={loadPreview}
        onViewInitial={vi.fn()}
        onJumpToTurn={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText('Current attachment preview.')).toBeInTheDocument();

    await act(async () => {
      stale.resolve({
        items: [
          {
            kind: 'included',
            message: {
              id: 'message-stale',
              eventTimestamp: '2026-07-21T08:00:00.000Z',
              importedAt: '2026-07-21T08:00:01.000Z',
              direction: 'incoming',
              speakerLabel: 'Contact',
              messageType: 'text',
              contentKind: 'text',
              content: 'Stale attachment preview.',
            },
          },
        ],
      });
      await stale.promise;
    });

    expect(screen.getByText('Current attachment preview.')).toBeInTheDocument();
    expect(screen.queryByText('Stale attachment preview.')).not.toBeInTheDocument();
  });
});
