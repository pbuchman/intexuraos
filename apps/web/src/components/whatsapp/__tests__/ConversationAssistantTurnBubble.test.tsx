/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationAssistantTurn } from '@/types';
import { ConversationAssistantTurnBubble } from '../ConversationAssistantTurnBubble.js';

afterEach(cleanup);

const attachment = {
  id: 'attachment-1',
  capturedAt: '2026-07-21T10:00:00.000Z',
  captureRange: {
    from: '2026-07-20T10:00:00.000Z',
    to: '2026-07-21T10:00:00.000Z',
  },
  eventRange: {
    from: '2026-07-20T12:00:00.000Z',
    to: '2026-07-21T09:30:00.000Z',
  },
  counts: {
    included: 18,
    excluded: 2,
    newlyAvailable: 18,
    edited: 1,
    redacted: 0,
    deleted: 0,
    reactionsChanged: 0,
    lateIngested: 0,
    completedTranscriptions: 1,
  },
  omitted: {
    mediaOnly: 2,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  },
};

function userTurn(): ConversationAssistantTurn {
  return {
    id: 'turn-user',
    sessionId: 'session-1',
    userId: 'user-1',
    role: 'user',
    text: 'How has their attitude changed?',
    createdAt: '2026-07-21T10:02:00.000Z',
    requestId: 'request-1',
    kind: 'context_attachment_question',
    contextAttachmentId: attachment.id,
    contextAttachment: attachment,
  };
}

describe('ConversationAssistantTurnBubble', () => {
  it('keeps the immutable attachment directly above its exact question', async () => {
    const user = userEvent.setup();
    const onViewContextAttachment = vi.fn();
    render(
      <ConversationAssistantTurnBubble
        turn={userTurn()}
        assistantRoleLabel="Psychologist"
        isStreaming={false}
        onViewContextAttachment={onViewContextAttachment}
        onRetryAnswer={vi.fn()}
      />
    );

    const card = screen.getByRole('group', {
      name: 'WhatsApp context update attached to this question',
    });
    const question = screen.getByText('How has their attitude changed?');
    expect(card.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(card).toHaveTextContent('18 included · 2 excluded');
    expect(card).toHaveTextContent('2 updates to earlier context');
    expect(screen.queryByRole('button', { name: /Remove/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View messages' }));
    expect(onViewContextAttachment).toHaveBeenCalledWith(attachment.id);
  });

  it('renders a deterministic acknowledgment before the assistant answer', () => {
    render(
      <ConversationAssistantTurnBubble
        turn={{
          id: 'turn-assistant',
          sessionId: 'session-1',
          userId: 'user-1',
          role: 'assistant',
          text: 'The tone became more collaborative.',
          acknowledgment: 'Added 18 new messages sent in the captured range.',
          createdAt: '2026-07-21T10:03:00.000Z',
        }}
        assistantRoleLabel="Psychologist"
        isStreaming={false}
        onViewContextAttachment={vi.fn()}
        onRetryAnswer={vi.fn()}
      />
    );

    const acknowledgment = screen.getByText('Added 18 new messages sent in the captured range.');
    const answer = screen.getByText('The tone became more collaborative.');
    expect(acknowledgment.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0
    );
  });

  it('keeps corrections-only checked range and omission reasons auditable after commit', () => {
    const correctionsOnly = userTurn();
    correctionsOnly.contextAttachment = {
      ...attachment,
      eventRange: undefined,
      counts: {
        ...attachment.counts,
        included: 0,
        excluded: 2,
        completedTranscriptions: 1,
        edited: 2,
      },
      omitted: {
        ...attachment.omitted,
        mediaOnly: 1,
        pendingTranscriptions: 1,
      },
    };
    render(
      <ConversationAssistantTurnBubble
        turn={correctionsOnly}
        assistantRoleLabel="Psychologist"
        displayTimeZone="Europe/Warsaw"
        isStreaming={false}
        onViewContextAttachment={vi.fn()}
        onRetryAnswer={vi.fn()}
      />
    );

    expect(screen.getByText('No new messages · 3 updates to earlier context')).toBeInTheDocument();
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
    expect(
      screen
        .getByRole('article')
        .querySelector('time[datetime="2026-07-21T10:02:00.000Z"]')
    ).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/July 21, 2026.*Europe\/Warsaw/)
    );
  });

  it('offers answer-only retry on the affected persisted error turn', async () => {
    const user = userEvent.setup();
    const onRetryAnswer = vi.fn();
    render(
      <ConversationAssistantTurnBubble
        turn={{
          id: 'turn-error',
          sessionId: 'session-1',
          userId: 'user-1',
          role: 'assistant',
          text: '',
          requestId: 'request-1',
          canRetryAnswer: true,
          createdAt: '2026-07-21T10:03:00.000Z',
          error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
        }}
        assistantRoleLabel="Psychologist"
        isStreaming={false}
        onViewContextAttachment={vi.fn()}
        onRetryAnswer={onRetryAnswer}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Try answer again' }));
    expect(onRetryAnswer).toHaveBeenCalledWith('request-1');
    expect(screen.queryByText(/LLM_ERROR/)).not.toBeInTheDocument();
    expect(screen.getByText('The assistant could not complete this answer.')).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveClass('min-w-0', 'max-w-[min(46rem,100%)]');
  });

  it('does not offer retry for a superseded persisted model failure', () => {
    render(
      <ConversationAssistantTurnBubble
        turn={{
          id: 'turn-old-error',
          sessionId: 'session-1',
          userId: 'user-1',
          role: 'assistant',
          text: '',
          requestId: 'request-old',
          canRetryAnswer: false,
          createdAt: '2026-07-21T10:03:00.000Z',
          error: { code: 'LLM_ERROR', message: 'The answer could not be generated' },
        }}
        assistantRoleLabel="Psychologist"
        isStreaming={false}
        onViewContextAttachment={vi.fn()}
        onRetryAnswer={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Try answer again' })).not.toBeInTheDocument();
  });

  it('does not offer a futile retry for a deterministic context-window failure', () => {
    render(
      <ConversationAssistantTurnBubble
        turn={{
          id: 'turn-too-large',
          sessionId: 'session-1',
          userId: 'user-1',
          role: 'assistant',
          text: 'This update is too large to include in one question.',
          requestId: 'request-1',
          createdAt: '2026-07-21T10:03:00.000Z',
          error: {
            code: 'CONTEXT_WINDOW_EXCEEDED',
            message: 'This update is too large to include in one question.',
          },
        }}
        assistantRoleLabel="Psychologist"
        isStreaming={false}
        onViewContextAttachment={vi.fn()}
        onRetryAnswer={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Try answer again' })).not.toBeInTheDocument();
    expect(screen.queryByText(/CONTEXT_WINDOW_EXCEEDED/)).not.toBeInTheDocument();
    expect(screen.getByText(/Start a new analysis with a smaller range/i)).toBeInTheDocument();
  });
});
