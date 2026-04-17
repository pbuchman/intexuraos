import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { DailySummary } from '@/types/notificationDigests';

function buildMarkdown(summary: DailySummary): string {
  const lines: string[] = [];
  lines.push(`# ${summary.date} · ${summary.groupKey}`);
  lines.push('');
  lines.push(`Wiadomości: ${String(summary.messageCount)}`);
  lines.push('');
  if (summary.headline.trim() !== '') {
    lines.push(`## ${summary.headline}`);
    lines.push('');
  }
  if (summary.bullets.length > 0) {
    for (const b of summary.bullets) lines.push(`- ${b}`);
    lines.push('');
  }
  if (summary.threads.length > 0) {
    lines.push('## Wątki');
    for (const t of summary.threads) {
      lines.push(`- **${t.topic}** (${t.resolved ? 'rozwiązany' : 'otwarty'}) — uczestnicy: ${t.participants.join(', ')}`);
      for (const f of t.keyFacts) lines.push(`  - ${f}`);
    }
    lines.push('');
  }
  if (summary.moderatorPosts.length > 0) {
    lines.push('## Posty moderatora');
    for (const p of summary.moderatorPosts) {
      lines.push(`- \`${p.time}\` **${p.topic}** — ${p.summary}`);
    }
    lines.push('');
  }
  if (summary.openQuestions.length > 0) {
    lines.push('## Otwarte pytania');
    for (const q of summary.openQuestions) lines.push(`- ${q}`);
  }
  return lines.join('\n');
}

interface DigestActionsProps {
  readonly summary: DailySummary;
}

export function DigestActions({ summary }: DigestActionsProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const copy = useCallback((): void => {
    setCopyError(null);
    void navigator.clipboard.writeText(buildMarkdown(summary)).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    }).catch(() => {
      setCopyError('Schowek niedostępny');
    });
  }, [summary]);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Skopiowano' : 'Kopiuj jako Markdown'}
      </button>
      {copyError !== null ? (
        <span className="text-xs text-red-600 dark:text-red-400">{copyError}</span>
      ) : null}
    </div>
  );
}
