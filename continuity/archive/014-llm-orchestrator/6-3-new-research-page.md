# Task 6-3: Create New Research Page

**Tier:** 6 (Depends on 6-2, 6-0)

---

## Context Snapshot

- API client and hooks available (6-2)
- User's API keys info available (6-0)
- Need form for submitting new research

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create page for submitting new research:

1. Text area for research prompt
2. Checkboxes for LLM selection (disabled if no key)
3. Submit button
4. Redirect to detail page after creation

---

## Scope

**In scope:**

- ResearchAgentPage component
- Prompt textarea
- LLM selection checkboxes
- Integration with useLlmKeys for availability
- Submit and redirect

**Non-scope:**

- Research list (task 6-4)
- Research detail (task 6-5)

---

## Required Approach

### Step 1: Create page component

`apps/web/src/pages/ResearchAgentPage.tsx`:

```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLlmKeys } from '../hooks/useLlmKeys.js';
import { useResearches } from '../hooks/useResearch.js';
import type { LlmProvider } from '../services/ResearchAgentApi.types.js';

const PROVIDERS: Array<{ id: LlmProvider; name: string }> = [
  { id: 'google', name: 'Gemini (with web search)' },
  { id: 'openai', name: 'GPT-4o' },
  { id: 'anthropic', name: 'Claude (with web search)' },
];

export function ResearchAgentPage(): JSX.Element {
  const navigate = useNavigate();
  const { keys, loading: keysLoading } = useLlmKeys();
  const { createResearch } = useResearches();

  const [prompt, setPrompt] = useState('');
  const [selectedLlms, setSelectedLlms] = useState<LlmProvider[]>(['google']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProviderAvailable = (provider: LlmProvider): boolean => {
    if (keysLoading || keys === null) return false;
    return keys[provider] !== null;
  };

  const handleProviderToggle = (provider: LlmProvider): void => {
    setSelectedLlms((prev) =>
      prev.includes(provider)
        ? prev.filter((p) => p !== provider)
        : [...prev, provider]
    );
  };

  const handleSubmit = async (): Promise<void> => {
    if (prompt.length < 10) {
      setError('Prompt must be at least 10 characters');
      return;
    }
    if (selectedLlms.length === 0) {
      setError('Select at least one LLM');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const research = await createResearch({ prompt, selectedLlms });
      navigate(`/#/research/${research.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create research');
    } finally {
      setSubmitting(false);
    }
  };

  const googleAvailable = isProviderAvailable('google');

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">New Research</h1>
      <p className="text-gray-600 mb-6">
        Run your research prompt across multiple LLMs and get a synthesized report.
      </p>

      {!googleAvailable && !keysLoading ? (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-6">
          <p className="text-amber-800">
            <strong>Google API key required.</strong> Synthesis is powered by Gemini.
            <a href="/#/settings/api-keys" className="underline ml-1">
              Configure API keys
            </a>
          </p>
        </div>
      ) : null}

      <div className="space-y-6">
        <div>
          <label className="block font-medium mb-2">Research Prompt</label>
          <textarea
            value={prompt}
            onChange={(e): void => setPrompt(e.target.value)}
            placeholder="Enter your research question or topic..."
            className="w-full border rounded p-3 h-40 resize-none"
            disabled={submitting}
          />
          <p className="text-sm text-gray-500 mt-1">
            {prompt.length}/10000 characters (minimum 10)
          </p>
        </div>

        <div>
          <label className="block font-medium mb-2">Select LLMs</label>
          <div className="space-y-2">
            {PROVIDERS.map((provider) => {
              const available = isProviderAvailable(provider.id);
              const isSelected = selectedLlms.includes(provider.id);

              return (
                <label
                  key={provider.id}
                  className={`flex items-center gap-3 p-3 border rounded cursor-pointer ${
                    available ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed'
                  } ${isSelected ? 'border-blue-500 bg-blue-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(): void => handleProviderToggle(provider.id)}
                    disabled={!available || submitting}
                    className="w-4 h-4"
                  />
                  <span>{provider.name}</span>
                  {!available ? (
                    <span className="text-xs text-gray-500">(API key not configured)</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>

        {error !== null ? (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-red-800">
            {error}
          </div>
        ) : null}

        <button
          onClick={(): void => { void handleSubmit(); }}
          disabled={submitting || !googleAvailable || prompt.length < 10}
          className="bg-blue-600 text-white px-6 py-3 rounded font-medium disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Start Research'}
        </button>
      </div>
    </div>
  );
}
```

---

## Step Checklist

- [ ] Create `ResearchAgentPage.tsx`
- [ ] Implement prompt textarea
- [ ] Implement LLM checkboxes with availability check
- [ ] Implement submit with redirect
- [ ] Show warning if Google key missing
- [ ] Run verification commands

---

## Definition of Done

1. Page displays form
2. LLMs disabled if no API key
3. Submit creates research and redirects
4. Validation messages shown
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

1. Remove `ResearchAgentPage.tsx`

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
