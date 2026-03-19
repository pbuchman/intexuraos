import type { MouseEvent } from 'react';
import { stripMarkdown } from '@/utils';

export function handleBackdropClick(e: MouseEvent<HTMLDivElement>, onClose: () => void): void {
  if (e.target === e.currentTarget) {
    onClose();
  }
}

export function truncateContent(content: string, maxLength = 150): string {
  if (content.length <= maxLength) {
    return content;
  }
  const cleanText = stripMarkdown(content);
  if (cleanText.length <= maxLength) {
    return cleanText;
  }
  return cleanText.slice(0, maxLength).trim() + '...';
}
