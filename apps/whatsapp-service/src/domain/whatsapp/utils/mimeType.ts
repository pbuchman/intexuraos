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
  // Video
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
};

/**
 * Get file extension for a MIME type.
 * Returns 'bin' for unknown types.
 */
export function getExtensionFromMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? 'bin';
}
