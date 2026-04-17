/**
 * Polish prose narrative for the day. Uses lang="pl" for browser hyphenation
 * and max-w-prose + leading-relaxed for readability.
 */

import { Card } from '@/components';

interface DigestNarrativeProps {
  readonly narrative: string;
}

export function DigestNarrative({ narrative }: DigestNarrativeProps): React.JSX.Element | null {
  if (narrative.trim() === '') return null;
  return (
    <Card className="mb-6">
      <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">Podsumowanie</h3>
      <p
        lang="pl"
        className="max-w-prose leading-relaxed text-slate-700 dark:text-slate-200"
      >
        {narrative}
      </p>
    </Card>
  );
}
