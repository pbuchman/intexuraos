import { DEFAULT_OPENROUTER_MODELS } from '@intexuraos/llm-contract';
import { Card, Layout, OpenRouterKeyCard } from '@/components';
import { useLlmKeys } from '@/hooks';

interface ModelGroup {
  provider: string;
  models: { id: string; name: string }[];
}

function groupOpenRouterModels(): ModelGroup[] {
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const model of DEFAULT_OPENROUTER_MODELS) {
    const existing = groups.get(model.provider) ?? [];
    existing.push({ id: `or:${model.id}`, name: model.name });
    groups.set(model.provider, existing);
  }
  return [...groups].map(([provider, models]) => ({ provider, models }));
}

const MODEL_GROUPS = groupOpenRouterModels();

export function ApiKeysSettingsPage(): React.JSX.Element {
  const {
    keys,
    defaultModel,
    fallbackModel,
    loading,
    error,
    savingDefaultModel,
    setKey,
    deleteKey,
    testKey,
    setDefaultModel,
    setFallbackModel,
  } = useLlmKeys();

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  const accessSource = keys?.accessSource ?? 'unavailable';
  const userKeyFailed =
    accessSource === 'user' && keys?.testResults.openrouter?.status === 'failure';
  const modelSelectionDisabled =
    savingDefaultModel || accessSource === 'unavailable' || userKeyFailed;

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">LLM Settings</h2>
        <p className="text-slate-600 dark:text-slate-300">
          OpenRouter provides all model access. Add a personal key or use platform access.
        </p>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <OpenRouterKeyCard
        maskedKey={keys?.openrouter ?? null}
        accessSource={accessSource}
        testResult={keys?.testResults.openrouter ?? null}
        onSave={async (apiKey): Promise<void> => {
          await setKey('openrouter', apiKey);
        }}
        onDelete={async (): Promise<void> => {
          await deleteKey('openrouter');
        }}
        onTest={async () => await testKey('openrouter')}
      />

      <ModelPreferenceCard
        title="Default Model"
        description="The OpenRouter model used by default across application services."
        value={defaultModel}
        disabled={modelSelectionDisabled}
        onChange={(model): void => {
          if (model !== null) void setDefaultModel(model);
        }}
      />

      <ModelPreferenceCard
        title="Fallback Model"
        description="Used through OpenRouter if the default model fails. Optional."
        value={fallbackModel}
        excludedModel={defaultModel}
        allowNone
        disabled={modelSelectionDisabled || defaultModel === null}
        onChange={(model): void => {
          void setFallbackModel(model);
        }}
      />

      {userKeyFailed ? (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Fix or remove the failed personal key before changing model preferences. Removing it keeps these preferences and restores platform access.
        </div>
      ) : null}

    </Layout>
  );
}

interface ModelPreferenceCardProps {
  title: string;
  description: string;
  value: string | null;
  excludedModel?: string | null;
  allowNone?: boolean;
  disabled: boolean;
  onChange: (model: string | null) => void;
}

function ModelPreferenceCard({
  title,
  description,
  value,
  excludedModel,
  allowNone = false,
  disabled,
  onChange,
}: ModelPreferenceCardProps): React.JSX.Element {
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-slate-900 dark:text-slate-100">{title}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        <select
          aria-label={title}
          value={value ?? ''}
          onChange={(event): void => {
            onChange(event.target.value === '' ? null : event.target.value);
          }}
          disabled={disabled}
          className="min-w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
        >
          {allowNone ? <option value="">None</option> : <option value="" disabled>Select a model</option>}
          {MODEL_GROUPS.map((group) => (
            <optgroup key={group.provider} label={group.provider}>
              {group.models
                .filter((model) => model.id !== excludedModel)
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
    </Card>
  );
}
