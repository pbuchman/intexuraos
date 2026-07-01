import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { Layout } from '@/components';
import { useAuth } from '@/context';
import {
  addIntexAgentPromptPreference,
  deleteIntexAgentPromptPreference,
  getIntexAgentPromptPreferences,
  getIntexAgentPromptPreferenceVersion,
  listIntexAgentPromptPreferenceVersions,
  updateIntexAgentPromptPreference,
  type IntexAgentPromptPreferenceItem,
  type IntexAgentPromptPreferenceVersion,
  type IntexAgentPromptPreferenceVersionSummary,
  type IntexAgentPromptPreferences,
} from '@/services/intexAgentApi';
import { formatDateTime } from '@/utils/dateFormat';

const MAX_PREFERENCE_LENGTH = 500;
const EMPTY_PROMPT_BLOCK = 'No Intex Agent preferences are defined yet.';

type PendingAction =
  | 'load'
  | 'add'
  | `update:${string}`
  | `delete:${string}`
  | `version:${string}`
  | null;

interface EditingState {
  itemId: string;
  text: string;
}

function displayDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return 'Never';
  }
  return formatDateTime(value);
}

function actorLabel(
  actor: IntexAgentPromptPreferenceVersionSummary['createdBy'] | IntexAgentPromptPreferences['updatedBy']
): string {
  if (actor === null) {
    return 'Unknown';
  }
  return actor.actor === 'web_ui' ? 'Web UI' : 'Agent tool';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

function errorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

function validatePreferenceText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return 'Preference text cannot be empty.';
  }
  if (trimmed.length > MAX_PREFERENCE_LENGTH) {
    return `Preference text must be at most ${String(MAX_PREFERENCE_LENGTH)} characters.`;
  }
  if (containsControlCharacter(text)) {
    return 'Preference text cannot contain newlines or control characters.';
  }
  return null;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode <= 31 || charCode === 127) {
      return true;
    }
  }
  return false;
}

export function IntexAgentPreferencesPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [current, setCurrent] = useState<IntexAgentPromptPreferences | null>(null);
  const [versions, setVersions] = useState<IntexAgentPromptPreferenceVersionSummary[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<IntexAgentPromptPreferenceVersion | null>(null);
  const [newText, setNewText] = useState('');
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IntexAgentPromptPreferenceItem | null>(null);
  const [pending, setPending] = useState<PendingAction>('load');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshVersions = useCallback(async (): Promise<void> => {
    const token = await getAccessToken();
    setVersions(await listIntexAgentPromptPreferenceVersions(token));
  }, [getAccessToken]);

  const refreshAll = useCallback(async (): Promise<void> => {
    setPending('load');
    setError(null);
    try {
      const token = await getAccessToken();
      const [nextCurrent, nextVersions] = await Promise.all([
        getIntexAgentPromptPreferences(token),
        listIntexAgentPromptPreferenceVersions(token),
      ]);
      setCurrent(nextCurrent);
      setVersions(nextVersions);
    } catch (caught) {
      setError(errorMessage(caught, 'Failed to load preferences'));
    } finally {
      setPending(null);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (editing !== null || newText.trim() !== '') {
      const handler = (event: BeforeUnloadEvent): void => {
        event.preventDefault();
      };
      window.addEventListener('beforeunload', handler);
      return (): void => {
        window.removeEventListener('beforeunload', handler);
      };
    }
    return undefined;
  }, [editing, newText]);

  const newTextValidation = useMemo(() => validatePreferenceText(newText), [newText]);
  const editingValidation = useMemo(
    () => (editing === null ? null : validatePreferenceText(editing.text)),
    [editing]
  );

  const handleMutationError = useCallback(
    async (caught: unknown, fallback: string): Promise<void> => {
      if (errorCode(caught) === 'VERSION_CONFLICT') {
        const token = await getAccessToken();
        const [nextCurrent, nextVersions] = await Promise.all([
          getIntexAgentPromptPreferences(token),
          listIntexAgentPromptPreferenceVersions(token),
        ]);
        setCurrent(nextCurrent);
        setVersions(nextVersions);
        setError('Preferences changed before save. Refreshed current preferences.');
        return;
      }
      setError(errorMessage(caught, fallback));
    },
    [getAccessToken]
  );

  const handleAdd = useCallback(async (): Promise<void> => {
    if (current === null || newTextValidation !== null || pending !== null) {
      return;
    }
    setPending('add');
    setError(null);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const next = await addIntexAgentPromptPreference(token, {
        text: newText.trim(),
        expectedVersion: current.currentVersion,
      });
      setCurrent(next);
      setNewText('');
      setNotice('Preference added.');
      await refreshVersions();
    } catch (caught) {
      await handleMutationError(caught, 'Failed to add preference');
    } finally {
      setPending(null);
    }
  }, [current, getAccessToken, handleMutationError, newText, newTextValidation, pending, refreshVersions]);

  const handleSaveEdit = useCallback(
    async (item: IntexAgentPromptPreferenceItem): Promise<void> => {
      if (
        current === null ||
        editing === null ||
        editingValidation !== null ||
        editing.text.trim() === item.text ||
        pending !== null
      ) {
        return;
      }
      setPending(`update:${item.id}`);
      setError(null);
      setNotice(null);
      try {
        const token = await getAccessToken();
        const next = await updateIntexAgentPromptPreference(token, item.id, {
          text: editing.text.trim(),
          expectedVersion: current.currentVersion,
        });
        setCurrent(next);
        setEditing(null);
        setNotice('Preference updated.');
        await refreshVersions();
      } catch (caught) {
        await handleMutationError(caught, 'Failed to update preference');
      } finally {
        setPending(null);
      }
    },
    [current, editing, editingValidation, getAccessToken, handleMutationError, pending, refreshVersions]
  );

  const handleDelete = useCallback(async (): Promise<void> => {
    if (current === null || deleteTarget === null || pending !== null) {
      return;
    }
    setPending(`delete:${deleteTarget.id}`);
    setError(null);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const next = await deleteIntexAgentPromptPreference(token, deleteTarget.id, {
        expectedVersion: current.currentVersion,
      });
      setCurrent(next);
      setDeleteTarget(null);
      setNotice('Preference removed from current preferences.');
      await refreshVersions();
    } catch (caught) {
      await handleMutationError(caught, 'Failed to delete preference');
    } finally {
      setPending(null);
    }
  }, [current, deleteTarget, getAccessToken, handleMutationError, pending, refreshVersions]);

  const handleSelectVersion = useCallback(
    async (version: number): Promise<void> => {
      setPending(`version:${String(version)}`);
      setError(null);
      try {
        const token = await getAccessToken();
        setSelectedVersion(await getIntexAgentPromptPreferenceVersion(token, version));
      } catch (caught) {
        setError(errorMessage(caught, 'Failed to load version'));
      } finally {
        setPending(null);
      }
    },
    [getAccessToken]
  );

  return (
    <Layout>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 border-b border-slate-200 pb-5 dark:border-slate-800">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-slate-950 dark:text-slate-50">
                Intex Agent Preferences
              </h1>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900">
                  Current version {String(current?.currentVersion ?? 0)}
                </span>
                <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900">
                  Last updated {displayDate(current?.updatedAt)}
                </span>
                <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-900">
                  Updated by {actorLabel(current?.updatedBy ?? null)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void refreshAll();
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 sm:w-auto dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {error !== null ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}
        {notice !== null ? (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {notice}
          </div>
        ) : null}

        {pending === 'load' && current === null ? (
          <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading preferences
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <main className="space-y-6">
              <section className="space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Preference Rows
                  </h2>
                  <span className="text-sm text-slate-500">
                    {String(current?.items.length ?? 0)}/50 rows
                  </span>
                </div>

                <AddPreferenceForm
                  label="New preference"
                  value={newText}
                  validation={newTextValidation}
                  pending={pending === 'add'}
                  disabled={current === null || pending !== null}
                  onChange={setNewText}
                  onSubmit={() => {
                    void handleAdd();
                  }}
                />

                {current?.items.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    No preferences yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {current?.items.map((item, index) => (
                      <PreferenceRow
                        key={item.id}
                        item={item}
                        ordinal={index + 1}
                        editing={editing}
                        validation={editingValidation}
                        pending={pending}
                        onEdit={() => {
                          setEditing({ itemId: item.id, text: item.text });
                        }}
                        onCancelEdit={() => {
                          setEditing(null);
                        }}
                        onChangeEdit={(text) => {
                          setEditing({ itemId: item.id, text });
                        }}
                        onSave={() => {
                          void handleSaveEdit(item);
                        }}
                        onDelete={() => {
                          setDeleteTarget(item);
                        }}
                      />
                    ))}
                  </div>
                )}

              </section>

              <PromptPreview
                title="Current Injected Prompt Block"
                block={current?.renderedPromptBlock ?? ''}
              />
            </main>

            <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
              <section>
                <h2 className="mb-3 text-lg font-semibold text-slate-950 dark:text-slate-50">
                  Versions
                </h2>
                {versions.length === 0 ? (
                  <div className="rounded-md border border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    No versions yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {versions.map((version) => (
                      <button
                        key={version.version}
                        type="button"
                        onClick={() => {
                          void handleSelectVersion(version.version);
                        }}
                        className="block w-full rounded-md border border-slate-200 bg-white p-3 text-left text-sm shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                      >
                        <span className="font-medium text-slate-950 dark:text-slate-50">
                          Version {String(version.version)}
                        </span>
                        <span className="ml-2 text-slate-500">{version.changeType}</span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {displayDate(version.createdAt)} · {actorLabel(version.createdBy)}
                        </span>
                        {version.changedItemId !== undefined ? (
                          <span className="mt-1 block break-all font-mono text-xs text-slate-500">
                            {version.changedItemId}
                          </span>
                        ) : null}
                        {version.previousText !== undefined ? (
                          <span className="mt-2 block break-words text-xs text-slate-500">
                            Previous: {version.previousText}
                          </span>
                        ) : null}
                        {version.nextText !== undefined ? (
                          <span className="mt-1 block break-words text-xs text-slate-500">
                            Next: {version.nextText}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {selectedVersion !== null ? (
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                    Historical version {String(selectedVersion.version)}
                  </h2>
                  <PromptPreview title="Historical Prompt Block" block={selectedVersion.renderedPromptBlock} />
                </section>
              ) : null}
            </aside>
          </div>
        )}

        {deleteTarget !== null ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
                Remove current preference
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                This removes the row from current preferences. It remains visible in version history.
              </p>
              <p className="mt-3 rounded-md bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {deleteTarget.text}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200"
                  onClick={() => {
                    setDeleteTarget(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                  onClick={() => {
                    void handleDelete();
                  }}
                  disabled={pending === `delete:${deleteTarget.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove preference
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}

interface AddPreferenceFormProps {
  label: string;
  value: string;
  validation: string | null;
  pending: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

function AddPreferenceForm(props: AddPreferenceFormProps): React.JSX.Element {
  const canSubmit = !props.disabled && props.validation === null && props.value.trim() !== '';
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
        {props.label}
        <textarea
          className="mt-2 min-h-24 w-full resize-y rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
          value={props.value}
          maxLength={MAX_PREFERENCE_LENGTH}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      </label>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-slate-500">
          {props.validation ?? `${String(props.value.trim().length)}/${String(MAX_PREFERENCE_LENGTH)}`}
        </span>
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto dark:disabled:bg-slate-700"
          disabled={!canSubmit || props.pending}
          onClick={props.onSubmit}
        >
          {props.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add preference
        </button>
      </div>
    </div>
  );
}

interface PreferenceRowProps {
  item: IntexAgentPromptPreferenceItem;
  ordinal: number;
  editing: EditingState | null;
  validation: string | null;
  pending: PendingAction;
  onEdit: () => void;
  onCancelEdit: () => void;
  onChangeEdit: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
}

function PreferenceRow(props: PreferenceRowProps): React.JSX.Element {
  const isEditing = props.editing?.itemId === props.item.id;
  const editedText = isEditing ? props.editing?.text ?? '' : props.item.text;
  const saveDisabled =
    !isEditing ||
    props.validation !== null ||
    editedText.trim() === props.item.text ||
    props.pending !== null;
  return (
    <article className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">
            {String(props.ordinal)}.
          </div>
          <div className="break-all font-mono text-xs text-slate-500">{props.item.id}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          {isEditing ? (
            <button
              type="button"
              aria-label={`Cancel ${props.item.id}`}
              className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={props.onCancelEdit}
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Edit ${props.item.id}`}
              className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={props.onEdit}
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            aria-label={`Delete ${props.item.id}`}
            className="rounded-md border border-red-200 p-2 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
            onClick={props.onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isEditing ? (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            Edit {props.item.id}
            <textarea
              className="mt-1 min-h-24 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              value={editedText}
              maxLength={MAX_PREFERENCE_LENGTH}
              onChange={(event) => {
                props.onChangeEdit(event.target.value);
              }}
            />
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-slate-500">
              {props.validation ?? `${String(editedText.trim().length)}/${String(MAX_PREFERENCE_LENGTH)}`}
            </span>
            <button
              type="button"
              aria-label={`Save ${props.item.id}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto dark:disabled:bg-slate-700"
              disabled={saveDisabled}
              onClick={props.onSave}
            >
              <Save className="h-4 w-4" />
              Save
            </button>
          </div>
        </div>
      ) : (
        <textarea
          aria-label={`Preference ${props.item.id}`}
          className="min-h-20 w-full resize-y rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          value={props.item.text}
          readOnly
        />
      )}
    </article>
  );
}

function PromptPreview(props: { title: string; block: string }): React.JSX.Element {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-slate-950 dark:text-slate-50">{props.title}</h2>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 border-l-4 border-l-cyan-400 bg-slate-50 p-4 text-sm leading-6 text-slate-800 shadow-sm dark:border-slate-700 dark:border-l-cyan-500 dark:bg-slate-900 dark:text-slate-100">
        {props.block.trim() === '' ? EMPTY_PROMPT_BLOCK : props.block}
      </pre>
    </section>
  );
}
