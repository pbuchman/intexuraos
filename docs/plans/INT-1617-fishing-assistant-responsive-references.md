# Fishing Assistant Responsive References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Fishing Assistant web page usable on mobile, tablet, and desktop, and make assistant answer references collapsed by default.

**Architecture:** Keep the change entirely in `apps/web`. Use the existing React, TailwindCSS, `Card`, `Button`, and routing patterns; fix layout pressure by moving nested sidebars to wider breakpoints, adding `min-w-0`/wrapping contracts, and making reference details opt-in through an accessible disclosure state.

**Tech Stack:** React 19, Vite, TailwindCSS v4 utility classes, React Router, Vitest with Testing Library.

---

## Scope

Routes in scope:

- `/fishing-assistant/digests` via `apps/web/src/pages/fishing/FishingDigestsPage.tsx`
- `/fishing-assistant/digests/:groupKey/:date` via `apps/web/src/pages/fishing/FishingDigestViewPage.tsx`
- `/fishing-assistant/knowledge` via `apps/web/src/pages/fishing/FishingKnowledgeBasePage.tsx`
- `/fishing-assistant/knowledge/pages/:pageId` via `apps/web/src/pages/fishing/FishingKnowledgePageEditor.tsx`
- `/fishing-assistant/chat` and `/fishing-assistant/chat/:chatId` via `apps/web/src/pages/fishing/FishingChatPage.tsx`

Primary components in scope:

- `apps/web/src/components/fishing/FishingReferencesPanel.tsx`
- `apps/web/src/components/fishing/FishingChatPanel.tsx`
- `apps/web/src/components/fishing/FishingDigestList.tsx`
- `apps/web/src/components/fishing/FishingKnowledgeTree.tsx`
- `apps/web/src/components/fishing/FishingPageEditor.tsx`

Out of scope:

- Backend Fishing Assistant APIs.
- Data model changes.
- New service URLs or environment variables.
- Changes to shared notification digest domain behavior, except responsive containment around `DigestState` when embedded in the fishing digest detail page.

## Current Findings

- `FishingChatPage` and `FishingChatPanel` both switch to multi-column layout at `xl`. On a 1280px viewport with the main sidebar visible, the content area is about 976px wide; the outer references column consumes 360px and the inner chat list consumes 280px, leaving an unreadably narrow message column.
- `FishingReferencesPanel` renders every citation quote and metadata block expanded immediately. The requested behavior is that references are collapsed by default.
- Several fishing cards have horizontal pressure from long titles, group keys, metadata rows, action buttons, and markdown/preformatted content. The responsive fix should use `min-w-0`, `break-words`, `overflow-x-auto`, and mobile-first stacking rather than relying on global `overflow-x: hidden`.
- Existing web UI tests cover the fishing chat panel, references panel, knowledge hook, and chat hook. Add focused UI contract tests around the fishing components instead of introducing browser tooling that the repo does not currently use.

## Endpoint Changes

Modified: none.

Created: none.

Removed: none.

Unchanged:

- All Fishing Assistant HTTP request payloads.
- All Fishing Assistant HTTP response payloads.
- Auth behavior.
- Routing paths.
- Service configuration.

## Files

Modify:

- `apps/web/src/pages/fishing/FishingChatPage.tsx`
  - Move the references column to a wider breakpoint and pass the selected assistant message id to the references panel so selection changes reset to the collapsed default.
- `apps/web/src/components/fishing/FishingReferencesPanel.tsx`
  - Convert citation cards into accessible collapsed disclosures. Show source type and title in the collapsed summary; reveal `usedFor`, `date`, and `quote` only after expansion.
- `apps/web/src/components/fishing/__tests__/FishingReferencesPanel.test.tsx`
  - Assert all references are collapsed by default and expand one reference on user action.
- `apps/web/src/components/fishing/FishingChatPanel.tsx`
  - Add responsive layout guards for the chat list, message column, message bubbles, and form controls.
- `apps/web/src/components/fishing/__tests__/FishingChatPanel.test.tsx`
  - Assert the responsive class contracts on the panel root and message bubbles while preserving existing behavior tests.
- `apps/web/src/components/fishing/FishingDigestList.tsx`
  - Stack digest title/metadata and message count cleanly on small screens; prevent long text from overflowing.
- `apps/web/src/pages/fishing/FishingDigestsPage.tsx`
  - Ensure the month picker and group filters wrap without compressing the page title.
- `apps/web/src/pages/fishing/FishingDigestViewPage.tsx`
  - Add containment for markdown and move the digest state side panel to a wider breakpoint.
- `apps/web/src/pages/fishing/FishingKnowledgeBasePage.tsx`
  - Make folder/page grids, page cards, and page actions stack cleanly on small screens.
- `apps/web/src/components/fishing/FishingKnowledgeTree.tsx`
  - Make create-folder controls and folder rows responsive.
- `apps/web/src/components/fishing/FishingPageEditor.tsx`
  - Make editor actions, metadata cards, preview preformatted text, and the raw textarea responsive.

Create:

- `apps/web/src/components/fishing/__tests__/FishingResponsiveContracts.test.tsx`
  - Focused class-contract tests for digest list, knowledge tree, and page editor responsive structure.

## Task 1: Collapse References By Default

**Files:**

- Modify: `apps/web/src/components/fishing/FishingReferencesPanel.tsx`
- Modify: `apps/web/src/components/fishing/__tests__/FishingReferencesPanel.test.tsx`
- Modify: `apps/web/src/pages/fishing/FishingChatPage.tsx`

- [ ] **Step 1: Add failing tests for collapsed references**

In `FishingReferencesPanel.test.tsx`, keep the existing link assertions and add a default-collapsed behavior test:

```tsx
it('renders every reference collapsed by default and expands only the selected reference', () => {
  render(
    <MemoryRouter>
      <FishingReferencesPanel
        selectionKey="message-1"
        citations={[
          {
            sourceId: 'chunk-1',
            sourceType: 'knowledge_page',
            title: 'Spring Bait',
            quote: 'Use pinka with light groundbait.',
            usedFor: 'Groundbait recommendation',
            url: '/fishing-assistant/knowledge/pages/page-1',
            pageId: 'page-1',
          },
          {
            sourceId: 'digest-1',
            sourceType: 'digest',
            title: 'May 1 digest',
            quote: 'Members reported success on shallow water.',
            usedFor: 'Recent conditions',
            url: '/fishing-assistant/digests/feeder/2026-05-01',
            date: '2026-05-01',
          },
        ]}
      />
    </MemoryRouter>
  );

  const springButton = screen.getByRole('button', { name: /knowledge base spring bait/i });
  const digestButton = screen.getByRole('button', { name: /digest may 1 digest/i });

  expect(springButton).toHaveAttribute('aria-expanded', 'false');
  expect(digestButton).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText(/use pinka with light groundbait/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/members reported success/i)).not.toBeInTheDocument();

  fireEvent.click(springButton);

  expect(springButton).toHaveAttribute('aria-expanded', 'true');
  expect(digestButton).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText(/use pinka with light groundbait/i)).toBeInTheDocument();
  expect(screen.queryByText(/members reported success/i)).not.toBeInTheDocument();
});
```

Add the imports needed by this test:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
```

- [ ] **Step 2: Add a failing reset-on-selection test**

Add a rerender test so references collapse again when a different assistant answer is selected:

```tsx
it('collapses expanded references when the selected assistant message changes', () => {
  const citations = [
    {
      sourceId: 'chunk-1',
      sourceType: 'knowledge_page' as const,
      title: 'Spring Bait',
      quote: 'Use pinka with light groundbait.',
      usedFor: 'Groundbait recommendation',
      url: '/fishing-assistant/knowledge/pages/page-1',
      pageId: 'page-1',
    },
  ];

  const { rerender } = render(
    <MemoryRouter>
      <FishingReferencesPanel selectionKey="message-1" citations={citations} />
    </MemoryRouter>
  );

  fireEvent.click(screen.getByRole('button', { name: /knowledge base spring bait/i }));
  expect(screen.getByText(/use pinka with light groundbait/i)).toBeInTheDocument();

  rerender(
    <MemoryRouter>
      <FishingReferencesPanel selectionKey="message-2" citations={citations} />
    </MemoryRouter>
  );

  expect(screen.getByRole('button', { name: /knowledge base spring bait/i })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  expect(screen.queryByText(/use pinka with light groundbait/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run the focused failing test**

Run:

```bash
pnpm --filter @intexuraos/web test -- src/components/fishing/__tests__/FishingReferencesPanel.test.tsx
```

Expected: FAIL because `FishingReferencesPanel` does not accept `selectionKey`, does not render disclosure buttons, and currently renders quotes immediately.

- [ ] **Step 4: Implement collapsed disclosures**

In `FishingReferencesPanel.tsx`, import React state helpers and `ChevronDown`:

```tsx
import { useEffect, useState } from 'react';
import { BookOpenText, ChevronDown, FileText, MessageSquareQuote } from 'lucide-react';
```

Update props:

```tsx
interface FishingReferencesPanelProps {
  readonly citations: readonly FishingMessageCitation[];
  readonly selectionKey?: string | null;
}
```

Add local expansion state that resets whenever the selected assistant message changes:

```tsx
const [expanded, setExpanded] = useState<Record<string, boolean>>({});

useEffect(() => {
  setExpanded({});
}, [selectionKey]);

const toggleReference = (key: string): void => {
  setExpanded((current) => ({ ...current, [key]: current[key] !== true }));
};
```

Render each citation as a collapsed row by default:

```tsx
{citations.map((citation, index) => {
  const referenceKey = `${citation.sourceId}-${citation.usedFor}-${String(index)}`;
  const isExpanded = expanded[referenceKey] === true;

  return (
    <div
      key={referenceKey}
      className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40"
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={(): void => { toggleReference(referenceKey); }}
        className="flex w-full min-w-0 items-center justify-between gap-3 p-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          {sourceIcon(citation.sourceType)}
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {sourceLabel(citation.sourceType)}
            </span>
            <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {citation.title}
            </span>
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>
      {isExpanded ? (
        <div className="space-y-2 border-t border-slate-200 px-3 pb-3 pt-3 dark:border-slate-700">
          <CitationTitle citation={citation} />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Used for: {citation.usedFor}
          </p>
          {citation.date !== undefined ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Date: {citation.date}</p>
          ) : null}
          <blockquote className="break-words border-l-2 border-slate-300 pl-3 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300">
            {citation.quote}
          </blockquote>
        </div>
      ) : null}
    </div>
  );
})}
```

Keep `CitationTitle` inside expanded content so link targets are still available after expansion.

- [ ] **Step 5: Pass the selected answer id from the chat page**

In `FishingChatPage.tsx`, change:

```tsx
<FishingReferencesPanel citations={selectedAssistant?.citations ?? []} />
```

to:

```tsx
<FishingReferencesPanel
  citations={selectedAssistant?.citations ?? []}
  selectionKey={selectedAssistant?.id ?? null}
/>
```

- [ ] **Step 6: Re-run the focused references test**

Run:

```bash
pnpm --filter @intexuraos/web test -- src/components/fishing/__tests__/FishingReferencesPanel.test.tsx
```

Expected: PASS.

## Task 2: Make Chat And References Responsive

**Files:**

- Modify: `apps/web/src/pages/fishing/FishingChatPage.tsx`
- Modify: `apps/web/src/components/fishing/FishingChatPanel.tsx`
- Modify: `apps/web/src/components/fishing/__tests__/FishingChatPanel.test.tsx`

- [ ] **Step 1: Add failing responsive contract assertions to the chat panel test**

In `FishingChatPanel.test.tsx`, add assertions to the existing "opens chats, starts a new chat, and sends messages" test:

```tsx
const panel = screen.getByTestId('fishing-chat-panel');
expect(panel).toHaveClass('grid', 'gap-4', 'lg:grid-cols-[260px_minmax(0,1fr)]');

const selectedMessage = screen.getByTestId('fishing-chat-message-message-2');
expect(selectedMessage).toHaveClass('w-full', 'max-w-full', 'sm:max-w-[90%]');
```

Expected failure: the component does not expose the test ids and the message bubble uses only `max-w-[90%]`.

- [ ] **Step 2: Run the focused failing chat test**

Run:

```bash
pnpm --filter @intexuraos/web test -- src/components/fishing/__tests__/FishingChatPanel.test.tsx
```

Expected: FAIL until the responsive contract is implemented.

- [ ] **Step 3: Move the chat page references column to a wider breakpoint**

In `FishingChatPage.tsx`, change the outer layout from:

```tsx
<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
```

to:

```tsx
<div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
```

This keeps chat and references stacked at laptop widths where the app sidebar already consumes horizontal space.

- [ ] **Step 4: Add chat panel root and child containment**

In `FishingChatPanel.tsx`, change the root from:

```tsx
<div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
```

to:

```tsx
<div
  data-testid="fishing-chat-panel"
  className="grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]"
>
```

Change the chat list card:

```tsx
<Card className="h-full min-w-0">
```

Change the chat transcript card:

```tsx
<Card className="flex min-h-[520px] min-w-0 flex-col sm:min-h-[620px]">
```

Update the chat list header and new-chat button so they stack on small screens:

```tsx
<div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
```

and:

```tsx
<Button size="sm" className="w-full sm:w-auto" onClick={(): void => { void onCreateChat(); }}>
```

- [ ] **Step 5: Make message bubbles mobile-safe**

In the message bubble `className`, replace:

```tsx
max-w-[90%]
```

with:

```tsx
w-full max-w-full sm:max-w-[90%]
```

Add the message test id:

```tsx
data-testid={`fishing-chat-message-${message.id}`}
```

Keep user messages right-aligned with the existing `ml-auto` class. The `w-full` class only applies on small screens; the `sm:max-w-[90%]` cap restores the desktop bubble width.

- [ ] **Step 6: Keep citation labels and form actions from overflowing**

In `FishingChatPanel.tsx`:

- Add `min-w-0` to message header wrappers that contain timestamps.
- Add `break-words` to user message content.
- Change the form action row to `className="mt-3 flex justify-stretch sm:justify-end"`.
- Change the send button to `className="w-full sm:w-auto"`.

Use this exact button shape:

```tsx
<Button type="submit" isLoading={sending} loadingText="Sending..." className="w-full sm:w-auto">
```

- [ ] **Step 7: Re-run the focused chat test**

Run:

```bash
pnpm --filter @intexuraos/web test -- src/components/fishing/__tests__/FishingChatPanel.test.tsx
```

Expected: PASS.

## Task 3: Make Digest And Knowledge Pages Responsive

**Files:**

- Modify: `apps/web/src/components/fishing/FishingDigestList.tsx`
- Modify: `apps/web/src/pages/fishing/FishingDigestsPage.tsx`
- Modify: `apps/web/src/pages/fishing/FishingDigestViewPage.tsx`
- Modify: `apps/web/src/pages/fishing/FishingKnowledgeBasePage.tsx`
- Modify: `apps/web/src/components/fishing/FishingKnowledgeTree.tsx`
- Modify: `apps/web/src/components/fishing/FishingPageEditor.tsx`
- Create: `apps/web/src/components/fishing/__tests__/FishingResponsiveContracts.test.tsx`

- [ ] **Step 1: Add failing responsive contract tests**

Create `FishingResponsiveContracts.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FishingDigestList } from '../FishingDigestList.js';
import { FishingKnowledgeTree } from '../FishingKnowledgeTree.js';
import { FishingPageEditor } from '../FishingPageEditor.js';
import type { FishingKnowledgePage } from '@/types/fishingAssistant';

describe('Fishing responsive layout contracts', () => {
  it('keeps digest rows stackable on narrow screens', () => {
    render(
      <MemoryRouter>
        <FishingDigestList
          digests={[
            {
              groupKey: 'very-long-fishing-group-key-that-should-not-overflow',
              date: '2026-05-01',
              title: 'Very long digest title that should wrap instead of pushing the badge off screen',
              summaryMarkdown: 'A long digest summary with enough content to verify wrapping behavior.',
              messageCount: 123,
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('fishing-digest-row')).toHaveClass('min-w-0');
    expect(screen.getByTestId('fishing-digest-row-header')).toHaveClass('flex-col', 'sm:flex-row');
    expect(screen.getByTestId('fishing-digest-message-count')).toHaveClass('shrink-0', 'self-start');
  });

  it('keeps knowledge folder controls usable on narrow screens', () => {
    render(
      <FishingKnowledgeTree
        folders={[
          {
            id: 'folder-1',
            userId: 'user-1',
            name: 'Long folder name that should truncate instead of overflowing',
            parentId: null,
            sortOrder: 0,
            pageCount: 3,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
          },
        ]}
        selectedFolderId="folder-1"
        busy={false}
        onSelectFolder={vi.fn()}
        onCreateFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /create folder/i })).toHaveClass(
      'w-full',
      'sm:w-auto'
    );
    expect(screen.getByTestId('fishing-folder-row-folder-1')).toHaveClass('min-w-0');
  });

  it('keeps the page editor actions and preview responsive', () => {
    const page: FishingKnowledgePage = {
      id: 'page-1',
      userId: 'user-1',
      folderId: 'folder-1',
      title: 'Long knowledge page title',
      rawText: 'raw content',
      normalizedText: 'normalized content',
      contentType: 'notes',
      indexingStatus: 'ready',
      chunkCount: 2,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };

    render(
      <MemoryRouter>
        <FishingPageEditor
          page={page}
          folderName="Folder"
          rawText="raw content"
          saving={false}
          reindexing={false}
          deleting={false}
          error={null}
          onRawTextChange={vi.fn()}
          onSave={vi.fn()}
          onReindex={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('fishing-page-editor-actions')).toHaveClass('w-full', 'sm:w-auto');
    expect(screen.getByTestId('fishing-page-editor-grid')).toHaveClass('min-w-0');
    expect(screen.getByTestId('fishing-page-preview')).toHaveClass('overflow-auto', 'break-words');
  });
});
```

- [ ] **Step 2: Run the focused failing responsive contract test**

Run:

```bash
pnpm --filter @intexuraos/web test -- src/components/fishing/__tests__/FishingResponsiveContracts.test.tsx
```

Expected: FAIL because the tested `data-testid` attributes and responsive classes do not exist yet.

- [ ] **Step 3: Update digest list rows**

In `FishingDigestList.tsx`, update the digest link:

```tsx
className="block min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
data-testid="fishing-digest-row"
```

Update the row header:

```tsx
<div
  data-testid="fishing-digest-row-header"
  className="mb-2 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
>
```

Update the title container and title:

```tsx
<div className="min-w-0">
  <h3 className="break-words font-semibold text-slate-900 dark:text-slate-100">
    {digest.title}
  </h3>
```

Update the message count:

```tsx
<span
  data-testid="fishing-digest-message-count"
  className="shrink-0 self-start rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
>
```

Add `break-words` to the excerpt container.

- [ ] **Step 4: Update digests page header and filters**

In `FishingDigestsPage.tsx`:

- Add `min-w-0` to the header wrapper.
- Add `min-w-0` to the title container.
- Change the month picker wrapper behavior by wrapping it in:

```tsx
<div className="w-full sm:w-auto">
  <MonthPicker month={month} onChange={setMonth} />
</div>
```

- Add `min-w-0` and `break-words` to group filter buttons so long display names wrap without page overflow.

- [ ] **Step 5: Update digest detail layout**

In `FishingDigestViewPage.tsx`, change:

```tsx
<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
```

to:

```tsx
<div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
```

Change the summary card:

```tsx
<div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
```

Add `break-words` to the header title and metadata paragraph.

- [ ] **Step 6: Update knowledge tree controls**

In `FishingKnowledgeTree.tsx`:

- Change the card to `<Card title="Folders" className="h-full min-w-0">`.
- Change the create button to:

```tsx
<Button
  type="submit"
  size="sm"
  disabled={busy || newFolderName.trim() === ''}
  className="w-full sm:w-auto"
>
```

- Add the folder row test id and containment:

```tsx
data-testid={`fishing-folder-row-${folder.id}`}
className={`min-w-0 rounded-lg border p-3 ${...}`}
```

- Ensure the folder action button wrapper uses `className="flex shrink-0 items-center gap-1"`.

- [ ] **Step 7: Update knowledge base page layout and page cards**

In `FishingKnowledgeBasePage.tsx`:

- Change the main grid to `className="grid min-w-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]"`.
- Change the page-list panel to include `min-w-0 overflow-hidden`.
- Change page card headers from `flex flex-wrap` to mobile-first stacking:

```tsx
<div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
```

- Add `min-w-0` to the page title container.
- Add `break-words` to page titles, metadata, and excerpts.
- Change the `Open` and `Delete` action wrapper to `className="flex w-full shrink-0 gap-2 sm:w-auto"`.
- Give the `Open` link and `Delete` button `className` values that include `flex-1 text-center sm:flex-none`.

- [ ] **Step 8: Update page editor actions and preview**

In `FishingPageEditor.tsx`:

- Add `min-w-0` to the root container.
- Change the header wrapper to `className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"`.
- Change the action wrapper:

```tsx
<div data-testid="fishing-page-editor-actions" className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
```

- Add `className="w-full sm:w-auto"` to the `Reindex`, `Save`, and `Delete` buttons.
- Change the editor grid:

```tsx
<div
  data-testid="fishing-page-editor-grid"
  className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"
>
```

- Change the textarea classes to include `min-h-[420px] resize-y`.
- Change the preview `pre`:

```tsx
<pre
  data-testid="fishing-page-preview"
  className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300"
>
```

- [ ] **Step 9: Re-run the responsive contract test**

Run:

```bash
pnpm --filter @intexuraos/web test -- src/components/fishing/__tests__/FishingResponsiveContracts.test.tsx
```

Expected: PASS.

## Task 4: Full Verification And Cleanup

**Files:**

- No additional source files unless focused verification exposes a missed fishing page.

- [ ] **Step 1: Run all fishing component tests**

Run:

```bash
pnpm --filter @intexuraos/web test -- src/components/fishing/__tests__/FishingReferencesPanel.test.tsx src/components/fishing/__tests__/FishingChatPanel.test.tsx src/components/fishing/__tests__/FishingResponsiveContracts.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run web typecheck/build through the workspace verifier**

Run:

```bash
pnpm run verify:workspace:tracked -- web
```

Expected: PASS.

- [ ] **Step 3: Run tracked CI before committing**

Run from repo root:

```bash
pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 4: Manual responsive smoke pass**

Start the web app if it is not already running:

```bash
pnpm --filter @intexuraos/web dev -- --host 0.0.0.0
```

Open these hash routes at 375px, 768px, 1280px, and 1536px viewport widths:

- `/#/fishing-assistant/digests`
- `/#/fishing-assistant/digests/<groupKey>/<date>` using any digest link visible in the list
- `/#/fishing-assistant/knowledge`
- `/#/fishing-assistant/knowledge/pages/<pageId>` using any knowledge page link visible in the list
- `/#/fishing-assistant/chat`

Confirm:

- No horizontal page scroll appears.
- Chat messages are readable and not squeezed by the references panel at laptop widths.
- References are collapsed before any click.
- Expanding one reference does not expand every reference.
- Long titles, group keys, metadata, quotes, and preview text wrap or scroll inside their own container.

## Rollback Plan

This is a web-only presentation change. If deployment reveals a regression, revert the PR. No data cleanup, backend rollback, migration rollback, or environment variable change is required.
