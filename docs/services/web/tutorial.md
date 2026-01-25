# Web App — Tutorial

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

The web app requires environment variables. Create a `.env` file:

```bash
# Copy from example or use direnv
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

**Checkpoint:** You should see the landing page with the "Your brain is for thinking" hero section.

---

## Part 2: Connect to Backend Services (10 minutes

### Step 2.1: Local vs Remote Services

The web app can connect to either:

| Option          | When to Use         | How                              |
| --------------- | ------------------- | -------------------------------- |
| Cloud services  | Default integration | No config needed (uses env vars) |
| Local emulators | Offline development | Set `FIRESTORE_EMULATOR_HOST`    |

### Step 2.2: Service URLs

Configure backend URLs in your `.env` file:

```bash
# Production URLs (default)
INTEXURAOS_USER_SERVICE_URL=https://user-service.intexuraos.com
INTEXURAOS_COMMANDS_AGENT_URL=https://commands-agent.intexuraos.com
# ... etc

# Or local development (if running services locally)
INTEXURAOS_USER_SERVICE_URL=http://localhost:8001
INTEXURAOS_COMMANDS_AGENT_URL=http://localhost:8002
```

### Step 2.3: Firebase Configuration

For Firestore, configure your project:

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
      <h1 className="text-2xl font-bold">My Settings</h1>
      <Card title="">
        <p>Settings content here</p>
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

### Task 2: Call a New API Endpoint

**Step 3.4:** Create the API function:

```typescript
// apps/web/src/services/myFeatureApi.ts
import { apiRequest } from './apiClient';

export async function getMyFeature(token: string): Promise<FeatureData> {
  return await apiRequest<FeatureData>(
    import.meta.env['INTEXURAOS_MY_SERVICE_URL'],
    '/my-feature',
    token
  );
}
```

**Step 3.5:** Export from `services/index.ts`:

```typescript
export * from './myFeatureApi.js';
```

**Step 3.6:** Use in a component:

```typescript
import { useApiClient } from '@/hooks/useApiClient';
import { getMyFeature } from '@/services';

function MyComponent() {
  const { request } = useApiClient();

  useEffect(() => {
    (async () => {
      const data = await request(getMyFeature);
      // Use data
    })();
  }, [request]);
}
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

### Step 4.2: Preview Build

```bash
pnpm preview
```

Serves the production build locally at `http://localhost:3000`

---

## Troubleshooting

| Problem                                 | Solution                                                    |
| --------------------------------------- | ----------------------------------------------------------- |
| "Missing required environment variable" | Check `.env` file has all `INTEXURAOS_*` variables          |
| "Auth0 unauthorized"                    | Verify `AUTH_AUDIENCE` matches your Auth0 API configuration |
| "CORS errors"                           | Ensure backend service allows requests from localhost       |
| "Service worker not registering"        | Clear site data and reload in DevTools Application tab      |
| "Vite HMR not working"                  | Check port 3000 is not already in use                       |

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
- MSW for API mocking (if needed)

---

## Next Steps

Now that you understand the basics:

1. Explore the [`InboxPage.tsx`](../../../apps/web/src/pages/InboxPage.tsx) to learn real-time update patterns
2. Read [`apiClient.ts`](../../../apps/web/src/services/apiClient.ts) for request handling
3. Check [`App.tsx`](../../../apps/web/src/App.tsx) for routing structure

---

## Exercises

Test your understanding:

1. **Easy:** Add a new link to the sidebar in `Layout.tsx`
2. **Medium:** Create a new page that fetches and displays a list of items from an API
3. **Hard:** Implement real-time updates using Firestore listeners for a new data type

<details>
<summary>Solutions</summary>

### Exercise 1: Sidebar Link

Edit `components/Layout.tsx`:

```typescript
<Link
  to="/my-page"
  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100"
>
  <Icon className="h-5 w-5" />
  <span>My Page</span>
</Link>
```

### Exercise 2: List Page

Create `apps/web/src/pages/MyListPage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Layout } from '@/components';
import { useApiClient } from '@/hooks/useApiClient';
import { getMyItems } from '@/services';

type Item = { id: string; name: string };

export function MyListPage(): React.JSX.Element {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const { request } = useApiClient();

  useEffect(() => {
    (async () => {
      try {
        const data = await request(getMyItems);
        setItems(data);
      } finally {
        setLoading(false);
      }
    })();
  }, [request]);

  return (
    <Layout>
      <h1 className="text-2xl font-bold">My Items</h1>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>
      )}
    </Layout>
  );
}
```

### Exercise 3: Firestore Listeners

Create `apps/web/src/hooks/useMyItemsChanges.ts`:

```typescript
import { useEffect, useState, useRef } from 'react';
import { getFirestoreClient } from '@/services/firebase';

export function useMyItemsChanges(enabled: boolean) {
  const [changedIds, setChangedIds] = useState<string[]>([]);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const firestore = getFirestoreClient();
    const listener = firestore.collection('myItems').onSnapshot((snapshot) => {
      const ids = snapshot.docs.map((doc) => doc.id);
      setChangedIds(ids);
    });

    unsubscribeRef.current = () => listener();

    return () => {
      unsubscribeRef.current?.();
    };
  }, [enabled]);

  return { changedIds };
}
```

</details>
