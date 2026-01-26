import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

export interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps): React.JSX.Element {
  return (
    <div className="prose prose-slate max-w-none overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
