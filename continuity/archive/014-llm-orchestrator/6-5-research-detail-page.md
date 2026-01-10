# Task 6-5: Create Research Detail Page

**Tier:** 6 (Depends on 6-2)

---

## Context Snapshot

- useResearch hook available (6-2)
- Need page to display research details and results

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create page showing research details:

1. Synthesized result (main content)
2. Individual LLM results in collapsible sections
3. Processing status with progress
4. Copy button for results

---

## Scope

**In scope:**

- ResearchDetailPage component
- Markdown rendering for results
- Collapsible LLM result sections
- Copy to clipboard
- Processing status display

**Non-scope:**

- Navigation (task 6-6)

---

## Required Approach

### Step 1: Create page component

`apps/web/src/pages/ResearchDetailPage.tsx`:

```typescript
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useResearch } from '../hooks/useResearch.js';
import type { LlmResult, ResearchStatus } from '../services/ResearchAgentApi.types.js';

const STATUS_CONFIG: Record<ResearchStatus, { color: string; label: string }> = {
  pending: { color: 'text-gray-600', label: 'Waiting to start...' },
  processing: { color: 'text-blue-600', label: 'Processing...' },
  completed: { color: 'text-green-600', label: 'Completed' },
  failed: { color: 'text-red-600', label: 'Failed' },
};

export function ResearchDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { research, loading, error } = useResearch(id ?? '');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const copyToClipboard = async (text: string, section: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (error !== null || research === null) {
    return (
      <div className="p-6">
        <div className="text-red-600 mb-4">
          {error ?? 'Research not found'}
        </div>
        <Link to="/#/research" className="text-blue-600 underline">
          Back to list
        </Link>
      </div>
    );
  }

  const status = STATUS_CONFIG[research.status];
  const isProcessing = research.status === 'pending' || research.status === 'processing';

  return (
    <div className="p-6 max-w-4xl">
      <Link to="/#/research" className="text-blue-600 text-sm mb-4 block">
        ← Back to list
      </Link>

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold">
            {research.title || 'Processing...'}
          </h1>
          <p className={`text-sm ${status.color} mt-1`}>
            {status.label}
            {research.status === 'processing' && (
              <span className="ml-2 animate-pulse">●</span>
            )}
          </p>
        </div>
      </div>

      <div className="bg-gray-50 rounded p-4 mb-6">
        <h3 className="font-medium text-sm text-gray-600 mb-2">Original Prompt</h3>
        <p className="text-gray-800">{research.prompt}</p>
      </div>

      {isProcessing ? (
        <ProcessingStatus llmResults={research.llmResults} />
      ) : null}

      {research.synthesizedResult !== undefined ? (
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Synthesis Report</h2>
            <button
              onClick={(): void => { void copyToClipboard(research.synthesizedResult ?? '', 'synthesis'); }}
              className="text-sm text-blue-600 hover:underline"
            >
              {copiedSection === 'synthesis' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="prose max-w-none bg-white border rounded p-6">
            <MarkdownContent content={research.synthesizedResult} />
          </div>
        </div>
      ) : null}

      {research.synthesisError !== undefined ? (
        <div className="bg-red-50 border border-red-200 rounded p-4 mb-8">
          <h3 className="font-medium text-red-800">Synthesis Failed</h3>
          <p className="text-red-700 text-sm mt-1">{research.synthesisError}</p>
        </div>
      ) : null}

      <div>
        <h2 className="text-xl font-bold mb-4">Individual LLM Results</h2>
        <div className="space-y-4">
          {research.llmResults.map((result) => (
            <LlmResultCard
              key={result.provider}
              result={result}
              onCopy={(text): void => { void copyToClipboard(text, result.provider); }}
              copied={copiedSection === result.provider}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProcessingStatus({ llmResults }: { llmResults: LlmResult[] }): JSX.Element {
  return (
    <div className="border rounded p-4 mb-6">
      <h3 className="font-medium mb-3">Processing Status</h3>
      <div className="space-y-2">
        {llmResults.map((result) => (
          <div key={result.provider} className="flex items-center gap-3">
            <StatusDot status={result.status} />
            <span className="capitalize">{result.provider}</span>
            <span className="text-gray-500 text-sm">
              {result.status === 'completed' && result.durationMs !== undefined
                ? `(${(result.durationMs / 1000).toFixed(1)}s)`
                : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }): JSX.Element {
  const colors: Record<string, string> = {
    pending: 'bg-gray-300',
    processing: 'bg-blue-500 animate-pulse',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
  };

  return <div className={`w-3 h-3 rounded-full ${colors[status] ?? 'bg-gray-300'}`} />;
}

interface LlmResultCardProps {
  result: LlmResult;
  onCopy: (text: string) => void;
  copied: boolean;
}

function LlmResultCard({ result, onCopy, copied }: LlmResultCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded">
      <button
        onClick={(): void => setExpanded(!expanded)}
        className="w-full flex justify-between items-center p-4 hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <StatusDot status={result.status} />
          <span className="font-medium capitalize">{result.provider}</span>
          <span className="text-gray-500 text-sm">{result.model}</span>
        </div>
        <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && result.result !== undefined ? (
        <div className="border-t p-4">
          <div className="flex justify-end mb-2">
            <button
              onClick={(): void => onCopy(result.result ?? '')}
              className="text-sm text-blue-600 hover:underline"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="prose max-w-none text-sm">
            <MarkdownContent content={result.result} />
          </div>
          {result.sources !== undefined && result.sources.length > 0 ? (
            <div className="mt-4 pt-4 border-t">
              <h4 className="font-medium text-sm mb-2">Sources</h4>
              <ul className="text-sm text-blue-600">
                {result.sources.map((source, i) => (
                  <li key={i}>
                    <a href={source} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {source}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {expanded && result.error !== undefined ? (
        <div className="border-t p-4 bg-red-50">
          <p className="text-red-700 text-sm">{result.error}</p>
        </div>
      ) : null}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }): JSX.Element {
  // Simple markdown rendering - in production use a library like react-markdown
  return (
    <div
      className="whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
```

---

## Step Checklist

- [ ] Create `ResearchDetailPage.tsx`
- [ ] Implement synthesis display
- [ ] Implement processing status
- [ ] Implement collapsible LLM results
- [ ] Implement copy to clipboard
- [ ] Run verification commands

---

## Definition of Done

1. Page displays research details
2. Synthesis shown prominently
3. Individual results collapsible
4. Copy buttons work
5. Processing status shown while running
6. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Remove `ResearchDetailPage.tsx`

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
