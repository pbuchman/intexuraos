import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { MessageItem } from '../MessageItem.js';
import type { WhatsAppMessage } from '@/types';

const mockGetMessageMediaUrl = vi.fn();
const mockWriteText = vi.fn();

vi.mock('@/components', () => ({
  AudioPlayer: ({
    messageId,
  }: {
    messageId: string;
    accessToken: string;
  }): React.JSX.Element => <div>{`Audio player ${messageId}`}</div>,
  ImageThumbnail: ({
    messageId,
    onClick,
    size,
  }: {
    messageId: string;
    accessToken: string;
    onClick: () => void;
    size?: 'compact' | 'preview';
  }): React.JSX.Element => (
    <button type="button" onClick={onClick} data-size={size}>
      {`Image thumbnail ${messageId}`}
    </button>
  ),
}));

vi.mock('@/services', () => ({
  getMessageMediaUrl: (...args: unknown[]): ReturnType<typeof mockGetMessageMediaUrl> =>
    mockGetMessageMediaUrl(...args),
}));

function createMessage(overrides?: Partial<WhatsAppMessage>): WhatsAppMessage {
  return {
    id: 'message-1',
    text: 'Create a detailed project update with all open questions and blockers.',
    fromNumber: '+15555550123',
    timestamp: '2026-03-25T16:45:00',
    receivedAt: '2026-03-25T16:45:00',
    mediaType: 'text',
    hasMedia: false,
    caption: null,
    ...overrides,
  };
}

describe('MessageItem', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockWriteText,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders separate mobile and desktop shells for text messages', () => {
    render(
      <MessageItem
        message={createMessage()}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={vi.fn()}
        onNoteClick={vi.fn()}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    const mobileShell = screen.getByTestId('message-item-mobile');
    const desktopShell = screen.getByTestId('message-item-desktop');

    expect(mobileShell).toHaveClass('sm:hidden');
    expect(desktopShell).toHaveClass('hidden', 'sm:grid');
    expect(within(mobileShell).getByText('Create a detailed project update with all open questions and blockers.')).toHaveClass('line-clamp-2', 'break-words');
    expect(within(mobileShell).getByText(/^Mar 25, 4:45 [AP]M$/)).toBeInTheDocument();
  });

  it('shows touch-visible actions on mobile and hover-reveal actions on desktop for text messages', () => {
    render(
      <MessageItem
        message={createMessage()}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={vi.fn()}
        onNoteClick={vi.fn()}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    const mobileShell = screen.getByTestId('message-item-mobile');
    const desktopShell = screen.getByTestId('message-item-desktop');

    expect(within(mobileShell).getByTitle('View note')).not.toHaveClass('opacity-0');
    expect(within(mobileShell).getByLabelText('Copy message')).not.toHaveClass('opacity-0');
    expect(within(mobileShell).getByTitle('Delete')).not.toHaveClass('opacity-0');

    expect(within(desktopShell).getByTitle('View note')).toHaveClass('sm:opacity-0', 'sm:group-hover:opacity-100');
    expect(within(desktopShell).getByLabelText('Copy message')).toHaveClass('sm:opacity-0', 'sm:group-hover:opacity-100');
    expect(within(desktopShell).getByTitle('Delete')).toHaveClass('sm:opacity-0', 'sm:group-hover:opacity-100');
  });

  it('keeps image rows readable on mobile and preserves the full-size action', () => {
    render(
      <MessageItem
        message={createMessage({
          id: 'image-1',
          mediaType: 'image',
          hasMedia: true,
          text: '',
          caption: 'https://example.com/reference-image-caption',
        })}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={vi.fn()}
        onNoteClick={vi.fn()}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    const mobileShell = screen.getByTestId('message-item-mobile');

    expect(within(mobileShell).getByText('https://example.com/reference-image-caption')).toHaveClass('line-clamp-2');
    expect(within(mobileShell).getByTitle('View note')).toBeInTheDocument();
    expect(within(mobileShell).getByLabelText('Copy message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Image thumbnail image-1' })).toHaveAttribute('data-size', 'compact');
    expect(screen.getByTitle('Open full size in new tab')).toBeInTheDocument();
  });

  it('opens image previews without also opening the note modal from the row click', () => {
    const onImageClick = vi.fn();
    const onNoteClick = vi.fn();

    render(
      <MessageItem
        message={createMessage({
          id: 'image-1',
          mediaType: 'image',
          hasMedia: true,
          text: '',
          caption: 'Reference image caption',
        })}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={onImageClick}
        onNoteClick={onNoteClick}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Image thumbnail image-1' }));

    expect(onImageClick).toHaveBeenCalledWith('image-1');
    expect(onNoteClick).not.toHaveBeenCalled();
  });

  it('opens the image preview when clicking an image row with media', () => {
    const onImageClick = vi.fn();
    const onNoteClick = vi.fn();

    render(
      <MessageItem
        message={createMessage({
          id: 'image-1',
          mediaType: 'image',
          hasMedia: true,
          text: '',
          caption: 'Reference image caption',
        })}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={onImageClick}
        onNoteClick={onNoteClick}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    const row = screen.getByTestId('message-item-row');
    expect(row).toHaveClass('cursor-pointer');

    fireEvent.click(row);

    expect(onImageClick).toHaveBeenCalledWith('image-1');
    expect(onNoteClick).not.toHaveBeenCalled();
  });

  it('shows a transcription action for completed audio messages and hides it for processing audio messages', () => {
    const { rerender } = render(
      <MessageItem
        message={createMessage({
          id: 'audio-complete',
          mediaType: 'audio',
          hasMedia: true,
          text: '',
          transcriptionStatus: 'completed',
          transcription: 'Completed transcription text',
        })}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={vi.fn()}
        onNoteClick={vi.fn()}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    const completedMobileShell = screen.getByTestId('message-item-mobile');
    const completedDesktopShell = screen.getByTestId('message-item-desktop');

    expect(within(completedMobileShell).getByTitle('View transcription')).not.toHaveClass('opacity-0');
    expect(within(completedDesktopShell).getByTitle('View transcription')).toHaveClass('sm:opacity-0', 'sm:group-hover:opacity-100');

    rerender(
      <MessageItem
        message={createMessage({
          id: 'audio-processing',
          mediaType: 'audio',
          hasMedia: true,
          text: '',
          transcriptionStatus: 'processing',
          transcription: '',
        })}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={vi.fn()}
        onNoteClick={vi.fn()}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    expect(within(screen.getByTestId('message-item-mobile')).queryByTitle('View transcription')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('message-item-desktop')).queryByTitle('View transcription')).not.toBeInTheDocument();
  });

  it('shows transcription actions and transcript content for completed video messages', () => {
    const onTranscriptionClick = vi.fn();

    render(
      <MessageItem
        message={createMessage({
          id: 'video-complete',
          mediaType: 'video',
          hasMedia: true,
          text: 'Video caption',
          transcriptionStatus: 'completed',
          transcription: 'Completed video transcription text',
        })}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={vi.fn()}
        onNoteClick={vi.fn()}
        onTranscriptionClick={onTranscriptionClick}
        isDeleting={false}
      />
    );

    const mobileShell = screen.getByTestId('message-item-mobile');
    const desktopShell = screen.getByTestId('message-item-desktop');
    expect(within(mobileShell).getByTitle('View transcription')).toBeInTheDocument();
    expect(within(desktopShell).getByTitle('View transcription')).toBeInTheDocument();
    expect(screen.getAllByText('Completed video transcription text').length).toBeGreaterThan(0);

    fireEvent.click(within(mobileShell).getByTitle('View transcription'));

    expect(onTranscriptionClick).toHaveBeenCalledTimes(1);
  });

  it('shows transcribing status in mobile shell for processing audio', () => {
    render(
      <MessageItem
        message={createMessage({
          mediaType: 'audio',
          hasMedia: true,
          text: '',
          transcriptionStatus: 'processing',
        })}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={vi.fn()}
        onNoteClick={vi.fn()}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    expect(
      within(screen.getByTestId('message-item-mobile')).getByText('Transcribing...')
    ).toBeInTheDocument();
  });

  it('shows transcription failed status in mobile shell for failed audio', () => {
    render(
      <MessageItem
        message={createMessage({
          mediaType: 'audio',
          hasMedia: true,
          text: '',
          transcriptionStatus: 'failed',
        })}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={vi.fn()}
        onNoteClick={vi.fn()}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    expect(
      within(screen.getByTestId('message-item-mobile')).getByText('Transcription failed')
    ).toBeInTheDocument();
  });

  it('does not open a modal when clicking a text message row', () => {
    const onImageClick = vi.fn();
    const onNoteClick = vi.fn();
    render(
      <MessageItem
        message={createMessage()}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={onImageClick}
        onNoteClick={onNoteClick}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    const row = screen.getByTestId('message-item-row');
    expect(row).not.toHaveClass('cursor-pointer');

    fireEvent.click(row);
    expect(onImageClick).not.toHaveBeenCalled();
    expect(onNoteClick).not.toHaveBeenCalled();
  });

  it('does not open the image preview when clicking an image row without media', () => {
    const onImageClick = vi.fn();
    const onNoteClick = vi.fn();
    render(
      <MessageItem
        message={createMessage({
          id: 'image-without-media',
          mediaType: 'image',
          hasMedia: false,
          text: '',
          caption: 'Image metadata without stored media',
        })}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={onImageClick}
        onNoteClick={onNoteClick}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    const row = screen.getByTestId('message-item-row');
    expect(row).not.toHaveClass('cursor-pointer');

    fireEvent.click(row);

    expect(onImageClick).not.toHaveBeenCalled();
    expect(onNoteClick).not.toHaveBeenCalled();
  });

  it('does not open a modal when clicking an audio message row', () => {
    const onImageClick = vi.fn();
    const onNoteClick = vi.fn();
    render(
      <MessageItem
        message={createMessage({
          id: 'audio-1',
          mediaType: 'audio',
          hasMedia: true,
          text: '',
          transcriptionStatus: 'completed',
          transcription: 'Some transcription',
        })}
        accessToken="token"
        onDelete={vi.fn()}
        onImageClick={onImageClick}
        onNoteClick={onNoteClick}
        onTranscriptionClick={vi.fn()}
        isDeleting={false}
      />
    );

    const row = screen.getByTestId('message-item-row');
    expect(row).not.toHaveClass('cursor-pointer');

    fireEvent.click(row);
    expect(onImageClick).not.toHaveBeenCalled();
    expect(onNoteClick).not.toHaveBeenCalled();
  });
});
