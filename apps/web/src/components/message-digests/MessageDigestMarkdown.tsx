import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Ref } from 'react';

interface MessageDigestMarkdownProps {
  markdown: string;
  className: string;
  containerRef?: Ref<HTMLDivElement>;
}

const SAFE_MARKDOWN_COMPONENTS: Components = {
  img: ({ alt }) => (
    <span className="inline-flex max-w-full break-words rounded bg-slate-100 px-1.5 py-0.5 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {alt?.trim() === '' || alt === undefined ? 'Image omitted' : alt}
    </span>
  ),
};

export function MessageDigestMarkdown({
  markdown,
  className,
  containerRef,
}: MessageDigestMarkdownProps): React.JSX.Element {
  return (
    <div ref={containerRef} className={className}>
      <ReactMarkdown components={SAFE_MARKDOWN_COMPONENTS} remarkPlugins={[remarkGfm]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
