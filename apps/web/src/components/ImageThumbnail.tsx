/**
 * Thumbnail component for image messages.
 * Fetches signed URL for thumbnail and displays clickable image.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Image as ImageIcon, Loader2 } from 'lucide-react';
import { ApiError, getMessageThumbnailUrl } from '@/services';

interface ImageThumbnailProps {
  messageId: string;
  accessToken: string;
  onClick: () => void;
  size?: 'compact' | 'preview';
}

export function ImageThumbnail({
  messageId,
  accessToken,
  onClick,
  size = 'preview',
}: ImageThumbnailProps): React.JSX.Element {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const boxClass = size === 'compact' ? 'h-8 w-8 rounded-md' : 'h-32 w-32 rounded-lg';
  const iconClass = size === 'compact' ? 'h-4 w-4' : 'h-8 w-8';
  const loaderClass = size === 'compact' ? 'h-4 w-4' : 'h-6 w-6';

  const fetchThumbnailUrl = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getMessageThumbnailUrl(accessToken, messageId);
      setThumbnailUrl(response.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load thumbnail');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, messageId]);

  useEffect(() => {
    void fetchThumbnailUrl();
  }, [fetchThumbnailUrl]);

  if (isLoading) {
    return (
      <div className={`flex ${boxClass} items-center justify-center bg-slate-100 dark:bg-slate-700`}>
        <Loader2 className={`${loaderClass} animate-spin text-slate-400 dark:text-slate-500`} />
      </div>
    );
  }

  if (error !== null) {
    return (
      <button
        type="button"
        onClick={(event): void => {
          event.stopPropagation();
          void fetchThumbnailUrl();
        }}
        className={`flex ${boxClass} flex-col items-center justify-center gap-2 bg-red-50 transition hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50`}
        title="Retry thumbnail"
      >
        <AlertCircle className={`${loaderClass} text-red-400`} />
        <span className={size === 'compact' ? 'sr-only' : 'text-xs text-red-600 dark:text-red-400'}>Retry</span>
      </button>
    );
  }

  if (thumbnailUrl === null) {
    return (
      <div className={`flex ${boxClass} items-center justify-center bg-slate-100 dark:bg-slate-700`}>
        <ImageIcon className={`${iconClass} text-slate-400 dark:text-slate-500`} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(event): void => {
        event.stopPropagation();
        onClick();
      }}
      className={`group relative shrink-0 overflow-hidden ${boxClass} transition hover:ring-2 hover:ring-blue-400`}
      aria-label="View image"
      title="View image"
    >
      <img
        src={thumbnailUrl}
        alt="Message thumbnail"
        className={`${boxClass} object-cover transition group-hover:scale-105`}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20">
        {size === 'preview' ? (
          <span className="translate-y-4 text-xs font-medium text-white opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
            Click to view
          </span>
        ) : null}
      </div>
    </button>
  );
}
