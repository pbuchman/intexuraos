# Web App -- Tutorial

> **Time:** 20-30 minutes
> **Prerequisites:** Node.js 22+, access to IntexuraOS project
> **You'll learn:** How to run, develop, and deploy the web app

---

## What You'll Build

A working local development environment for the IntexuraOS web app including:

- Running the dev server with hot reload
- Configuring environment variables
- Connecting to local emulators or cloud services
- Building for production

---

## Prerequisites

Before starting, ensure you have:

- [ ] Node.js 22+ installed
- [ ] pnpm package manager
- [ ] Access to the IntexuraOS GCP project
- [ ] Auth0 application credentials (for local auth)

---

## Part 1: Run the Development Server (5 minutes)

Let's start by running the app locally.

### Step 1.1: Install Dependencies

```bash
cd apps/web
pnpm install
```

### Step 1.2: Configure Environment

The web app requires environment variables. Use direnv (recommended) or create a `.env` file:

```bash
# Option A: direnv (recommended)
direnv allow

# Option B: Manual .env file
cp .env.example .env
```

Required variables:

```bash
INTEXURAOS_AUTH0_DOMAIN=your-domain.auth0.com
INTEXURAOS_AUTH0_SPA_CLIENT_ID=your-client-id
INTEXURAOS_AUTH_AUDIENCE=https://api.intexuraos.com
```

### Step 1.3: Start the Dev Server

```bash
pnpm dev
```

The app will be available at `http://localhost:3000`

**Checkpoint:** You should see the landing page with the brutalist-design hero section and animated terminal showing the autonomous pipeline.

---

## Part 2: Connect to Backend Services (10 minutes)

### Step 2.1: Local vs Remote Services

The web app can connect to either:

| Option         | When to Use       | How                                              |
| -------------- | ----------------- | ------------------------------------------------ |
| Cloud services | Production build  | `pnpm build` -- uses absolute service URLs       |
| Dev mode       | Local development | `pnpm dev` -- Vite proxy routes `/api/*` locally |

### Step 2.2: Vite Proxy Configuration

In dev mode, Vite proxies API requests to local services. The proxy is configured in `vite.config.ts`:

```typescript
// All /api/* requests are proxied to localhost services
'/api/user':    { target: 'http://localhost:8110' },
'/api/code':    { target: 'http://localhost:8128' },
'/api/chat':    { target: 'http://localhost:8129' },
// ... etc
```

You do not need to set service URL environment variables in dev mode.

### Step 2.3: Firebase Configuration

For Firestore real-time features, configure your project:

```bash
INTEXURAOS_FIREBASE_PROJECT_ID=intexuraos-production
INTEXURAOS_FIREBASE_API_KEY=your-api-key
INTEXURAOS_FIREBASE_AUTH_DOMAIN=intexuraos-production.firebaseapp.com
```

**Checkpoint:** Visit `http://localhost:3000/#/login` and click "Log In". Auth0 should redirect you.

---

## Part 3: Common Development Tasks (10 minutes)

### Task 1: Add a New Settings Page

**Step 3.1:** Create the page component:

```typescript
// apps/web/src/pages/MySettingsPage.tsx
import { Layout } from '@/components';
import { Card } from '@/components/ui/Card';

export function MySettingsPage(): React.JSX.Element {
  return (
    <Layout>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
        My Settings
      </h1>
      <Card title="">
        <p className="text-slate-600 dark:text-slate-400">Settings content here</p>
      </Card>
    </Layout>
  );
}
```

**Step 3.2:** Export from `pages/index.ts`:

```typescript
export { MySettingsPage } from './MySettingsPage.js';
```

**Step 3.3:** Add route in `App.tsx`:

```typescript
import { MySettingsPage } from '@/pages';

// In routes:
<Route
  path="/settings/my-feature"
  element={
    <ProtectedRoute>
      <MySettingsPage />
    </ProtectedRoute>
  }
/>
```

**Step 3.4:** Add sidebar navigation in `Sidebar.tsx`:

```typescript
const settingsItems: NavItem[] = [
  // ... existing items
  { to: '/settings/my-feature', label: 'My Feature', icon: YourIcon },
];
```

### Task 2: Call a New API Endpoint

**Step 3.5:** Create the API function:

```typescript
// apps/web/src/services/myFeatureApi.ts
import { apiRequest } from './apiClient.js';
import { config } from '@/config';

interface FeatureData {
  id: string;
  name: string;
}

export async function getMyFeature(token: string): Promise<FeatureData> {
  return await apiRequest<FeatureData>(
    config.myServiceUrl,
    '/my-feature',
    token
  );
}
```

**Step 3.6:** Use in a component with `useApiClient`:

```typescript
import { useApiClient } from '@/hooks/useApiClient';
import { config } from '@/config';

function MyComponent(): React.JSX.Element {
  const { request } = useApiClient();
  const [data, setData] = useState<FeatureData | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await request<FeatureData>(
        config.myServiceUrl, '/my-feature'
      );
      setData(result);
    })();
  }, [request]);

  return <div>{data?.name}</div>;
}
```

### Task 3: Add a Linear Issue Selector

Use `LinearIssueSelectorModal` when you need users to pick a Linear issue -- it replaced the inline combobox for better mobile UX:

```typescript
import { LinearIssueSelectorModal } from '@/components/LinearIssueSelectorModal';

function MyForm(): React.JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);

  return (
    <>
      <button onClick={() => setModalOpen(true)}>Select Linear Issue</button>
      <LinearIssueSelectorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={(issue) => {
          setSelectedIssue(issue.id);
          setModalOpen(false);
        }}
      />
    </>
  );
}
```

### Task 4: Persist UI State Across Page Refresh

Follow the pattern used in InboxPage and CodeTasksPage for persisting filter state:

```typescript
// Initialize from localStorage
const [myFilter, setMyFilter] = useState<string[]>(() => {
  const stored = localStorage.getItem('my-page-filter');
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // Invalid JSON, use defaults
    }
  }
  return ['default'];
});

// Persist on change
useEffect(() => {
  localStorage.setItem('my-page-filter', JSON.stringify(myFilter));
}, [myFilter]);
```

---

## Part 4: Build for Production (5 minutes)

### Step 4.1: Build Command

```bash
pnpm build
```

This creates a production-optimized build in `dist/` with:

- Minified JavaScript and CSS
- Source maps for debugging
- PWA service worker
- Asset hashing for cache busting
- Build version info injected (version, commit SHA, date)

### Step 4.2: Preview Build

```bash
pnpm preview
```

Serves the production build locally at `http://localhost:3000`

---

## Troubleshooting

| Problem                                 | Solution                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| "Missing required environment variable" | Check `.env` file has all `INTEXURAOS_*` variables or run `direnv allow`                   |
| "Auth0 unauthorized"                    | Verify `AUTH_AUDIENCE` matches your Auth0 API configuration                                |
| "CORS errors"                           | Ensure backend service allows requests from localhost                                      |
| "Service worker not registering"        | Clear site data and reload in DevTools Application tab                                     |
| "Vite HMR not working"                  | HMR is disabled by default (`hmr: false` in vite.config.ts); use full page reload          |
| DevBar not showing                      | Only visible in dev mode (`pnpm dev`) or on `dev.intexuraos.cloud`, not in production      |
| Chat not working as guest               | Guest sessions are rate-limited; clear `intex-guest-session-id` from localStorage to reset |
| Dark mode not persisting                | Ensure localStorage is available (not in strict private mode)                              |
| Linear board not updating               | Firestore listener may have expired; reload the page                                       |
| Code task log stream blank              | Firebase auth may have failed; check the browser console for auth errors                   |
| Filters lost on page refresh            | Verify localStorage is not being cleared; filters persist via localStorage keys            |

---

## Testing

### Run Tests

```bash
pnpm test           # Run once
pnpm test:watch     # Watch mode
pnpm test:coverage  # With coverage
```

### Test Configuration

Tests use Vitest with:

- jsdom environment for DOM testing
- @testing-library/react for component testing
- @testing-library/user-event for interaction testing

---

## Next Steps

Now that you understand the basics:

1. Explore the [`InboxPage.tsx`](../../../apps/web/src/pages/InboxPage.tsx) to learn real-time update patterns
2. Read [`apiClient.ts`](../../../apps/web/src/services/apiClient.ts) for request handling
3. Check [`App.tsx`](../../../apps/web/src/App.tsx) for routing structure
4. Study the [`Chat`](../../../apps/web/src/components/Chat/Chat.tsx) component for the chat assistant architecture
5. Review [`CodeTaskViewPage.tsx`](../../../apps/web/src/pages/CodeTaskViewPage.tsx) for collapsible tool output, agent-type banners, queued messaging, and LogStream
6. See [`PREventsPage.tsx`](../../../apps/web/src/pages/PREventsPage.tsx) for lazy-loaded summaries with `useGitHubPRSummaries` + `useGitHubPREvents`
7. Study [`CodeTasksPage.tsx`](../../../apps/web/src/pages/CodeTasksPage.tsx) for multi-status filtering with persistent state

---

## Exercises

Test your understanding:

1. **Easy:** Add a new link to the sidebar in `Sidebar.tsx`
2. **Medium:** Create a new page that fetches and displays a list of items from an API with persistent filter state
3. **Hard:** Implement real-time updates using Firestore listeners for a new data type

<details>
<summary>Solutions</summary>

### Exercise 1: Sidebar Link

Edit `components/Sidebar.tsx` and add to the appropriate section:

```typescript
<NavLink
  to="/my-page"
  end
  className={({ isActive }): string =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
    }`
  }
>
  <MyIcon className="h-5 w-5 shrink-0" />
  {!isCollapsed ? <span>My Page</span> : null}
</NavLink>
```

### Exercise 2: List Page with Persistent Filter

Create `apps/web/src/pages/MyListPage.tsx`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { Layout } from '@/components';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/context';
import { apiRequest } from '@/services/apiClient';
import { config } from '@/config';

type Item = { id: string; name: string; status: string };

export function MyListPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string[]>(() => {
    const stored = localStorage.getItem('my-list-filter');
    if (stored !== null) {
      try {
        return JSON.parse(stored) as string[];
      } catch { return []; }
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('my-list-filter', JSON.stringify(statusFilter));
  }, [statusFilter]);

  const fetchData = useCallback(async () => {
    const token = await getAccessToken();
    const data = await apiRequest<Item[]>(config.myServiceUrl, '/items', token);
    setItems(data);
    setLoading(false);
  }, [getAccessToken]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const filtered = statusFilter.length > 0
    ? items.filter((i) => statusFilter.includes(i.status))
    : items;

  return (
    <Layout>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">My Items</h1>
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <Card key={item.id} title={item.name}>
              <p className="text-slate-600 dark:text-slate-400">{item.status}</p>
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}
```

### Exercise 3: Firestore Listeners

Create `apps/web/src/hooks/useMyItemsChanges.ts`:

```typescript
import { useEffect, useState, useRef, useCallback } from 'react';
import { getFirestoreClient, authenticateFirebase } from '@/services/firebase';
import { useAuth } from '@/context';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

export function useMyItemsChanges(enabled: boolean): {
  changedIds: string[];
  clearChangedIds: () => void;
} {
  const { getAccessToken, isAuthenticated } = useAuth();
  const [changedIds, setChangedIds] = useState<string[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);

  const clearChangedIds = useCallback(() => {
    setChangedIds([]);
  }, []);

  useEffect(() => {
    if (!enabled || !isAuthenticated) return;

    void (async () => {
      const token = await getAccessToken();
      await authenticateFirebase(token);
      const db = getFirestoreClient();
      const q = query(collection(db, 'myItems'), where('userId', '==', 'current'));

      unsubRef.current = onSnapshot(q, (snapshot) => {
        const ids = snapshot.docChanges().map((change) => change.doc.id);
        setChangedIds((prev) => [...new Set([...prev, ...ids])]);
      });
    })();

    return () => {
      unsubRef.current?.();
    };
  }, [enabled, isAuthenticated, getAccessToken]);

  return { changedIds, clearChangedIds };
}
```

</details>
