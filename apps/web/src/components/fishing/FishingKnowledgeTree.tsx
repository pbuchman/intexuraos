import { useState } from 'react';
import { Folder, Pencil, Trash2 } from 'lucide-react';
import { Button, Card, Input } from '@/components';
import type { FishingKnowledgeFolder } from '@/types/fishingAssistant';

interface FishingKnowledgeTreeProps {
  readonly folders: readonly FishingKnowledgeFolder[];
  readonly selectedFolderId: string | undefined;
  readonly busy: boolean;
  readonly onSelectFolder: (folderId: string) => void;
  readonly onCreateFolder: (name: string) => Promise<void>;
  readonly onRenameFolder: (
    folderId: string,
    name: string,
    parentId: string | null,
    sortOrder: number
  ) => Promise<void>;
  readonly onDeleteFolder: (folderId: string) => Promise<void>;
}

export function FishingKnowledgeTree({
  folders,
  selectedFolderId,
  busy,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: FishingKnowledgeTreeProps): React.JSX.Element {
  const [newFolderName, setNewFolderName] = useState('');
  const sortedFolders = [...folders].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <Card title="Folders" className="h-full min-w-0">
      <form
        onSubmit={(event): void => {
          event.preventDefault();
          const name = newFolderName.trim();
          if (name === '') {
            return;
          }
          void onCreateFolder(name).then(() => {
            setNewFolderName('');
          });
        }}
        className="mb-4 space-y-2"
      >
        <Input
          label="New folder"
          value={newFolderName}
          onChange={(event): void => { setNewFolderName(event.target.value); }}
          placeholder="Recipes"
          disabled={busy}
        />
        <Button
          type="submit"
          size="sm"
          disabled={busy || newFolderName.trim() === ''}
          className="w-full sm:w-auto"
        >
          Create Folder
        </Button>
      </form>

      <div className="space-y-2">
        {sortedFolders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
            Create your first folder to start building the knowledge base.
          </div>
        ) : (
          sortedFolders.map((folder) => {
            const isSelected = folder.id === selectedFolderId;
            return (
              <div
                key={folder.id}
                data-testid={`fishing-folder-row-${folder.id}`}
                className={`min-w-0 rounded-lg border p-3 ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
                    : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={(): void => { onSelectFolder(folder.id); }}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <Folder className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {folder.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {String(folder.pageCount)} page{folder.pageCount === 1 ? '' : 's'}
                      </p>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Rename ${folder.name}`}
                      onClick={(): void => {
                        const nextName = window.prompt('Rename folder', folder.name);
                        if (nextName === null) {
                          return;
                        }
                        const trimmed = nextName.trim();
                        if (trimmed === '') {
                          return;
                        }
                        void onRenameFolder(folder.id, trimmed, folder.parentId, folder.sortOrder);
                      }}
                      className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${folder.name}`}
                      onClick={(): void => {
                        if (window.confirm(`Delete folder "${folder.name}"?`)) {
                          void onDeleteFolder(folder.id);
                        }
                      }}
                      className="rounded p-1 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
