import type { HellscriptDraftVersion } from '@/types';

interface HellscriptVersionSelectorProps {
  versions: HellscriptDraftVersion[];
  selectedVersionId: string | null;
  onSelect: (versionId: string) => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HellscriptVersionSelector({
  versions,
  selectedVersionId,
  onSelect,
}: HellscriptVersionSelectorProps): React.JSX.Element | null {
  if (versions.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="version-select"
        className="text-xs font-medium text-slate-500 dark:text-slate-400"
      >
        Version:
      </label>
      <select
        id="version-select"
        value={selectedVersionId ?? ''}
        onChange={(e): void => {
          onSelect(e.target.value);
        }}
        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            v{String(v.versionNumber)} - {formatDate(v.createdAt)}
          </option>
        ))}
      </select>
    </div>
  );
}
