# Task 6-1: Create API Keys Settings Page

**Tier:** 6 (Depends on 6-0)

---

## Context Snapshot

- useLlmKeys hook available (6-0)
- Settings pages exist in web app
- Need UI for managing LLM API keys

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create a settings page where users can:

1. View which LLM providers have API keys configured
2. Add/update API keys for each provider
3. Delete API keys

---

## Scope

**In scope:**

- ApiKeysSettingsPage component
- Key input forms for each provider
- Masked key display
- Delete confirmation

**Non-scope:**

- Key validation (testing API key works)
- Navigation/routing changes (task 6-6)

---

## Required Approach

### Step 1: Create page component

`apps/web/src/pages/ApiKeysSettingsPage.tsx`:

```typescript
import { useState } from 'react';
import { useLlmKeys } from '../hooks/useLlmKeys.js';
import type { LlmProvider } from '../services/llmKeysApi.types.js';

const PROVIDERS: Array<{ id: LlmProvider; name: string; description: string }> = [
  {
    id: 'google',
    name: 'Google (Gemini)',
    description: 'Required for research synthesis. Enables web search grounding.',
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    description: 'Optional. Adds GPT-4o to research options.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    description: 'Optional. Adds Claude with web search to research options.',
  },
];

export function ApiKeysSettingsPage(): JSX.Element {
  const { keys, loading, error, setKey, deleteKey } = useLlmKeys();

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (error !== null) {
    return <div className="p-6 text-red-600">Error: {error}</div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">API Keys</h1>
      <p className="text-gray-600 mb-8">
        Configure your LLM API keys. Keys are encrypted before storage.
      </p>

      <div className="space-y-6">
        {PROVIDERS.map((provider) => (
          <ApiKeyCard
            key={provider.id}
            provider={provider}
            currentValue={keys?.[provider.id] ?? null}
            onSave={(apiKey): void => { void setKey(provider.id, apiKey); }}
            onDelete={(): void => { void deleteKey(provider.id); }}
          />
        ))}
      </div>
    </div>
  );
}

interface ApiKeyCardProps {
  provider: { id: LlmProvider; name: string; description: string };
  currentValue: string | null;
  onSave: (apiKey: string) => void;
  onDelete: () => void;
}

function ApiKeyCard({ provider, currentValue, onSave, onDelete }: ApiKeyCardProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = (): void => {
    if (inputValue.length >= 10) {
      onSave(inputValue);
      setInputValue('');
      setIsEditing(false);
    }
  };

  const handleDelete = (): void => {
    onDelete();
    setShowDeleteConfirm(false);
  };

  const isConfigured = currentValue !== null;

  return (
    <div className="border rounded-lg p-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="font-semibold">{provider.name}</h3>
          <p className="text-sm text-gray-600">{provider.description}</p>
        </div>
        <span
          className={`px-2 py-1 rounded text-xs ${
            isConfigured ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {isConfigured ? 'Configured' : 'Not configured'}
        </span>
      </div>

      {isConfigured && !isEditing ? (
        <div className="mt-4 flex items-center gap-4">
          <code className="bg-gray-100 px-2 py-1 rounded text-sm">{currentValue}</code>
          <button
            onClick={(): void => setIsEditing(true)}
            className="text-blue-600 text-sm hover:underline"
          >
            Update
          </button>
          <button
            onClick={(): void => setShowDeleteConfirm(true)}
            className="text-red-600 text-sm hover:underline"
          >
            Delete
          </button>
        </div>
      ) : null}

      {isEditing || !isConfigured ? (
        <div className="mt-4">
          <input
            type="password"
            placeholder="Enter API key..."
            value={inputValue}
            onChange={(e): void => setInputValue(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleSave}
              disabled={inputValue.length < 10}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
            >
              Save
            </button>
            {isEditing ? (
              <button
                onClick={(): void => { setIsEditing(false); setInputValue(''); }}
                className="border px-4 py-2 rounded text-sm"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showDeleteConfirm ? (
        <div className="mt-4 p-3 bg-red-50 rounded">
          <p className="text-sm text-red-800 mb-2">
            Are you sure you want to delete this API key?
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              className="bg-red-600 text-white px-3 py-1 rounded text-sm"
            >
              Delete
            </button>
            <button
              onClick={(): void => setShowDeleteConfirm(false)}
              className="border px-3 py-1 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

---

## Step Checklist

- [ ] Create `ApiKeysSettingsPage.tsx`
- [ ] Create `ApiKeyCard` component
- [ ] Implement key input with masking
- [ ] Implement delete confirmation
- [ ] Run verification commands

---

## Definition of Done

1. Page displays all three providers
2. Shows configured/not configured status
3. Allows adding/updating keys
4. Allows deleting keys with confirmation
5. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Remove `ApiKeysSettingsPage.tsx`
