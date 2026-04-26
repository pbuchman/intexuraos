/**
 * Modal component for displaying full-size images.
 * Fetches signed URL on open and displays with loading state.
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { ApiError, getMessageMediaUrl } from '@/services';
import { Modal } from './ui/Modal.js';

interface ImageModalProps {
  messageId: string;
  accessToken: string;
  onClose: () => void;
}

export function ImageModal({
  messageId,
  accessToken,
  onClose,
}: ImageModalProps): React.JSX.Element {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchImageUrl = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getMessageMediaUrl(accessToken, messageId);
      setImageUrl(response.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load image');
    }
    finally {
      setIsLoading(false);
    }
  }, [accessToken, messageId]);

  useEffect(() => {
    void fetchImageUrl();
  }, [fetchImageUrl]);

  const handleDownload = (): void => {
    if (imageUrl !== null) {
      window.open(imageUrl, '_blank');
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open): void => {
        if (!open) onClose();
      }}
      title="Image preview"
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 flex max-h-[90vh] max-w-[90vw] items-center justify-center"
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
        aria-label="Close"
      >
        <X className="h-6 w-6" />
      </button>

      {/* Download button */}
      {imageUrl !== null && (
        <button
          onClick={handleDownload}
          className="absolute right-16 top-4 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
          aria-label="Download"
        >
          <Download className="h-6 w-6" />
        </button>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-white" />
        </div>
      ) : error !== null ? (
        <div className="rounded-lg bg-red-900/50 p-6 text-center text-white">
          <p className="text-lg">{error}</p>
          <button
            onClick={(): void => {
              void fetchImageUrl();
            }}
            className="mt-4 rounded-lg bg-white/20 px-4 py-2 transition hover:bg-white/30"
          >
            Retry
          </button>
        </div>
      ) : imageUrl !== null ? (
        <img
          src={imageUrl}
          alt="Full size"
          className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
        />
      ) : null}
    </Modal>
  );
}
