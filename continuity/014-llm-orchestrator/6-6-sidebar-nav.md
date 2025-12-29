# Task 6-6: Update Sidebar Navigation

**Tier:** 6 (Final frontend task)

---

## Context Snapshot

- All pages created (6-1 to 6-5)
- Need to add navigation links to sidebar
- Need to register routes in router

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Update sidebar and router to include:

1. LLM Orchestrator section
2. Settings → API Keys

---

## Scope

**In scope:**

- Update Sidebar.tsx with new sections
- Update App.tsx router with new routes
- Ensure hash routing works

**Non-scope:**

- Page implementations (done in 6-1 to 6-5)

---

## Required Approach

### Step 1: Update Sidebar

Find existing sidebar component and add:

```typescript
// Add to navigation items
const navItems = [
  // ... existing items
  {
    section: 'LLM Orchestrator',
    items: [
      { path: '/#/research/new', label: 'New Research', icon: PlusIcon },
      { path: '/#/research', label: 'Previous Researches', icon: ListIcon },
    ],
  },
  {
    section: 'Settings',
    items: [{ path: '/#/settings/api-keys', label: 'API Keys', icon: KeyIcon }],
  },
];
```

### Step 2: Update Router (App.tsx)

Add routes in the HashRouter:

```typescript
import { ApiKeysSettingsPage } from './pages/ApiKeysSettingsPage';
import { LlmOrchestratorPage } from './pages/LlmOrchestratorPage';
import { ResearchListPage } from './pages/ResearchListPage';
import { ResearchDetailPage } from './pages/ResearchDetailPage';

// In routes
<Route path="/settings/api-keys" element={<ApiKeysSettingsPage />} />
<Route path="/research/new" element={<LlmOrchestratorPage />} />
<Route path="/research/:id" element={<ResearchDetailPage />} />
<Route path="/research" element={<ResearchListPage />} />
```

### Step 3: Ensure hash routing

Verify all links use hash format:

- `/#/research/new` instead of `/research/new`
- `/#/settings/api-keys` instead of `/settings/api-keys`

---

## Step Checklist

- [ ] Identify current sidebar component
- [ ] Add LLM Orchestrator navigation section
- [ ] Add Settings → API Keys link
- [ ] Update App.tsx with new routes
- [ ] Verify hash routing format
- [ ] Run verification commands

---

## Definition of Done

1. Sidebar shows LLM Orchestrator section
2. Sidebar shows Settings → API Keys
3. All routes work correctly
4. Hash routing preserved
5. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
npm run build
```

---

## Rollback Plan

If verification fails:

1. Revert changes to Sidebar
2. Revert changes to App.tsx

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
