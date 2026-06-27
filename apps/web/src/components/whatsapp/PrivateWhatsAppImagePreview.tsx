import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useAuth } from '@/context';
import {
  getPrivateWhatsAppMessageMediaUrl,
  getPrivateWhatsAppMessageThumbnailUrl,
} from '@/services/whatsappApi';
import type { PrivateWhatsAppMessage } from '@/types';

interface PrivateWhatsAppImagePreviewProps {
  message: PrivateWhatsAppMessage;
}

export function PrivateWhatsAppImagePreview({
  message,
}: PrivateWhatsAppImagePreviewProps): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadThumbnail = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(false);
    try {
      const token = await getAccessToken();
      const response = await getPrivateWhatsAppMessageThumbnailUrl(token, message.id);
      setThumbnailUrl(response.url);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, message.id]);

  useEffect(() => {
    void loadThumbnail();
  }, [loadThumbnail]);

  const openOriginal = async (): Promise<void> => {
    try {
      const token = await getAccessToken();
      const response = await getPrivateWhatsAppMessageMediaUrl(token, message.id);
      window.open(response.url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(true);
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 w-64 max-w-full items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || thumbnailUrl === null) {
    return (
      <button
        type="button"
        onClick={(): void => {
          void loadThumbnail();
        }}
        className="inline-flex max-w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
      >
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>Retry image</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(): void => {
        void openOriginal();
      }}
      className="block max-w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left transition hover:border-blue-300 dark:border-slate-700 dark:bg-slate-800"
      aria-label="Open image"
    >
      <img
        src={thumbnailUrl}
        alt={message.media?.fileName ?? 'Private WhatsApp image'}
        className="max-h-80 w-auto max-w-full object-contain"
      />
      {message.media?.fileName !== undefined ? (
        <span className="flex items-center gap-2 border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <ImageIcon className="h-3.5 w-3.5" />
          <span className="truncate">{message.media.fileName}</span>
        </span>
      ) : null}
    </button>
  );
}
