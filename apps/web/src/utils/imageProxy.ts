import { config } from '@/config';

export function getProxiedImageUrl(imageUrl: string | null | undefined): string | null {
  if (imageUrl === null || imageUrl === undefined || imageUrl === '') {
    return null;
  }

  const encodedUrl = encodeURIComponent(imageUrl);
  return `${config.bookmarksAgentUrl}/images/proxy?url=${encodedUrl}`;
}
