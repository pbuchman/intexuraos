import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';

export interface MarkdownContentProps {
  content: string;
  allowHtml?: boolean;
}

export function MarkdownContent({ content, allowHtml }: MarkdownContentProps): React.JSX.Element {
  const rehypePlugins = allowHtml === true
    ? [rehypeRaw, rehypeHighlight]
    : [rehypeHighlight];

  return (
    <div className="prose prose-slate dark:prose-invert max-w-none overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
