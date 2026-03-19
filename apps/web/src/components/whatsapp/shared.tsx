/**
 * URL regex pattern for detecting links in text.
 */
const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;

/**
 * Renders text with clickable links.
 */
export function TextWithLinks({ text }: { text: string }): React.JSX.Element {
  const matches = [...text.matchAll(URL_REGEX)];
  const parts: { text: string; isLink: boolean }[] = [];
  let lastIndex = 0;

  for (const match of matches) {
    const matchIndex = match.index;
    // Add text before the match
    if (matchIndex > lastIndex) {
      parts.push({ text: text.slice(lastIndex, matchIndex), isLink: false });
    }
    // Add the link
    parts.push({ text: match[0], isLink: true });
    lastIndex = matchIndex + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isLink: false });
  }

  return (
    <>
      {parts.map((part, index) =>
        part.isLink ? (
          <a
            key={index}
            href={part.text}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            onClick={(e): void => {
              e.stopPropagation();
            }}
          >
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

// Media type filter config
export type WhatsAppMediaType = 'all' | 'text' | 'image' | 'audio';

export const WHATSAPP_MEDIA_TYPES: WhatsAppMediaType[] = ['all', 'text', 'image', 'audio'];

export const WHATSAPP_MEDIA_FILTER_CONFIG: Record<
  WhatsAppMediaType,
  { label: string; dotClass: string; activeClass: string }
> = {
  all: {
    label: 'All',
    dotClass: 'bg-blue-500',
    activeClass:
      'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
  },
  text: {
    label: 'Text',
    dotClass: 'bg-slate-400',
    activeClass:
      'border-slate-400 bg-slate-50 text-slate-600 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-400',
  },
  image: {
    label: 'Image',
    dotClass: 'bg-green-500',
    activeClass:
      'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400',
  },
  audio: {
    label: 'Audio',
    dotClass: 'bg-purple-500',
    activeClass:
      'border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-900/30 dark:text-purple-400',
  },
};

// Sort config
export type WhatsAppSortOption = 'newest' | 'oldest';

export const WHATSAPP_SORT_OPTIONS: { key: WhatsAppSortOption; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
];
