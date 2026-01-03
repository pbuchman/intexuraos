/**
 * MIME type utilities.
 */

const MIME_TO_EXTENSION: Record<string, string> = {
  // Audio
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  // Image
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Get file extension for a MIME type.
 * Returns 'bin' for unknown types.
 */
export function getExtensionFromMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? 'bin';
}
