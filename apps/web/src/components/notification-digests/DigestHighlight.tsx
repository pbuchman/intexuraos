import { Card } from '@/components';

interface DigestHighlightProps {
  readonly headline: string;
  readonly bullets: readonly string[];
}

export function DigestHighlight({
  headline,
  bullets,
}: DigestHighlightProps): React.JSX.Element | null {
  if (headline.trim() === '' || bullets.length === 0) return null;

  return (
    <Card className="mb-6">
      <h3 lang="en" className="mb-3 text-lg font-semibold leading-snug text-slate-900 dark:text-slate-100">
        {headline}
      </h3>
      <ul lang="en" className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
        {bullets.map((b, i) => (
          <li key={`${String(i)}-${b.slice(0, 24)}`}>{b}</li>
        ))}
      </ul>
    </Card>
  );
}
