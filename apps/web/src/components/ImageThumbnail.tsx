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
}

export function ImageThumbnail({
  messageId,
  accessToken,
  onClick,
}: ImageThumbnailProps): React.JSX.Element {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-slate-100">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <button
        onClick={(): void => {
          void fetchThumbnailUrl();
        }}
        className="flex h-32 w-32 flex-col items-center justify-center gap-2 rounded-lg bg-red-50 transition hover:bg-red-100"
      >
        <AlertCircle className="h-6 w-6 text-red-400" />
        <span className="text-xs text-red-600">Retry</span>
      </button>
    );
  }

  if (thumbnailUrl === null) {
    return (
      <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-slate-100">
        <ImageIcon className="h-8 w-8 text-slate-400" />
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-lg transition hover:ring-2 hover:ring-blue-400"
    >
      <img
        src={thumbnailUrl}
        alt="Message thumbnail"
        className="h-32 w-32 object-cover transition group-hover:scale-105"
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20">
        <span className="translate-y-4 text-xs font-medium text-white opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
          Click to view
        </span>
      </div>
    </button>
  );
}
