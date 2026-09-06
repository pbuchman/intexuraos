import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Music, Video } from 'lucide-react';
import { useAuth } from '@/context';
import { getPrivateWhatsAppMessageMediaUrl } from '@/services/whatsappApi';
import type { PrivateWhatsAppMessage } from '@/types';

interface PrivateWhatsAppMediaPlayerProps {
  message: PrivateWhatsAppMessage;
}

function getMediaName(message: PrivateWhatsAppMessage): string {
  return message.media?.fileName ?? message.media?.mimeType ?? `${message.messageType} message`;
}

export function PrivateWhatsAppMediaPlayer({
  message,
}: PrivateWhatsAppMediaPlayerProps): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mediaName = getMediaName(message);
  const isVideo = message.messageType === 'video';
  const Icon = isVideo ? Video : Music;

  const loadMedia = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(false);
    try {
      const token = await getAccessToken();
      const response = await getPrivateWhatsAppMessageMediaUrl(token, message.id);
      setMediaUrl(response.url);
    } catch {
      setMediaUrl(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, message.id]);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  if (loading) {
    return (
      <div className="flex h-12 w-full max-w-md items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || mediaUrl === null) {
    return (
      <button
        type="button"
        onClick={(): void => {
          void loadMedia();
        }}
        className="inline-flex max-w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
      >
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>Retry media</span>
      </button>
    );
  }

  return (
    <div className="max-w-full space-y-2">
      <span className="flex max-w-full items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{mediaName}</span>
      </span>
      {isVideo ? (
        <video
          aria-label={`Play ${mediaName}`}
          className="max-h-96 w-auto max-w-full rounded-lg bg-slate-950"
          controls
          preload="metadata"
          src={mediaUrl}
        />
      ) : (
        <audio
          aria-label={`Play ${mediaName}`}
          className="w-full max-w-md"
          controls
          preload="metadata"
          src={mediaUrl}
        />
      )}
    </div>
  );
}
