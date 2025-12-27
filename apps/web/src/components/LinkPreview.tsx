import type { LinkPreview as LinkPreviewType } from '@/types';

interface LinkPreviewProps {
  preview: LinkPreviewType;
}

/**
 * Get hostname from URL or siteName.
 */
function getHostname(preview: LinkPreviewType): string {
  if (preview.siteName !== undefined && preview.siteName !== '') {
    return preview.siteName;
  }
  try {
    return new URL(preview.url).hostname;
  } catch {
    return preview.url;
  }
}

/**
 * Single link preview card component.
 * Displays Open Graph metadata for a URL.
 */
export function LinkPreview({ preview }: LinkPreviewProps): React.JSX.Element {
  const hostname = getHostname(preview);

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors overflow-hidden"
    >
      {preview.image !== undefined && preview.image !== '' && (
        <div className="w-full h-32 bg-gray-200 overflow-hidden">
          <img
            src={preview.image}
            alt={preview.title ?? 'Link preview'}
            className="w-full h-full object-cover"
            onError={(e): void => {
              // Hide image on load error
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          {preview.favicon !== undefined && preview.favicon !== '' && (
            <img
              src={preview.favicon}
              alt=""
              className="w-4 h-4"
              onError={(e): void => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <span className="text-xs text-gray-500 truncate">{hostname}</span>
        </div>
        {preview.title !== undefined && preview.title !== '' && (
          <h4 className="text-sm font-medium text-gray-900 line-clamp-2 mb-1">{preview.title}</h4>
        )}
        {preview.description !== undefined && preview.description !== '' && (
          <p className="text-xs text-gray-600 line-clamp-2">{preview.description}</p>
        )}
      </div>
    </a>
  );
}
