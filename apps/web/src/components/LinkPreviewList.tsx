import type { LinkPreviewState } from '@/types';
import { LinkPreview } from './LinkPreview';

interface LinkPreviewListProps {
  linkPreview: LinkPreviewState | undefined;
}

/**
 * List of link previews for a message.
 * Handles pending, completed, and failed states.
 */
export function LinkPreviewList({ linkPreview }: LinkPreviewListProps): React.JSX.Element | null {
  if (linkPreview === undefined) {
    return null;
  }

  const { status, previews, error } = linkPreview;

  if (status === 'pending') {
    return <div className="mt-2 text-xs text-gray-400 italic">Loading link previews...</div>;
  }

  if (status === 'failed') {
    const errorMessage = error !== undefined ? `: ${error.message}` : '';
    return (
      <div className="mt-2 text-xs text-gray-400 italic">
        Failed to load link previews{errorMessage}
      </div>
    );
  }

  if (previews !== undefined && previews.length > 0) {
    return (
      <div className="mt-3 space-y-2">
        {previews.map((preview) => (
          <LinkPreview key={preview.url} preview={preview} />
        ))}
      </div>
    );
  }

  return null;
}
