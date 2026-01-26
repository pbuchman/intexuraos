# INT-389: Share History UX Improvements

## Overview

Fix Share History UX issues including status display consolidation, automatic sync recovery, and long URL overflow handling.

**Linear Issue:** [INT-389](https://linear.app/pbuchman/issue/INT-389)

---

## Requirements Summary

| #   | Requirement                        | Solution                                 |
| --- | ---------------------------------- | ---------------------------------------- |
| 1   | Combine status badge + footer info | Remove badge, show status in footer only |
| 2   | Investigate sync failure paths     | Documented below; fix auto-recovery      |
| 3   | Resync failed items                | Automatic recovery, no manual button     |
| 4   | Replace Clear with dropdown        | NOT NEEDED - keep single Clear button    |
| 5   | Per-item status instead of global  | Footer shows item-specific status        |
| 6   | Fix long link overflow             | CSS `break-all line-clamp-2`             |

---

## Files to Modify

| File                                        | Purpose                          |
| ------------------------------------------- | -------------------------------- |
| `apps/web/src/pages/ShareHistoryPage.tsx`   | UI layout changes                |
| `apps/web/src/services/shareQueue.ts`       | Remove markAsFailed, add helpers |
| `apps/web/src/context/SyncQueueContext.tsx` | Sync logic fixes                 |
| `apps/web/src/components/Header.tsx`        | Update sync indicator            |

---

## Implementation Details

### 1. ShareHistoryPage.tsx Changes

#### 1.1 Remove StatusBadge Component

**DELETE** the entire `StatusBadge` function (lines 6-37):

```typescript
// DELETE THIS ENTIRE FUNCTION
function StatusBadge({ status }: { status: ShareStatus }): React.JSX.Element {
  // ... all of it
}
```

#### 1.2 Update Item Layout

**REPLACE** the item rendering (inside the `history.map()`) with:

```tsx
<div key={item.id} className="py-4">
  {/* Content preview with overflow fix */}
  <p className="text-sm text-slate-900 break-all line-clamp-2">{item.contentPreview}</p>

  {/* Unified footer with status */}
  <div className="mt-2 flex items-center gap-2 text-xs">
    <span className="text-slate-500">{formatDate(item.createdAt)}</span>
    <span className="text-slate-400">·</span>
    <StatusText item={item} isOnline={isOnline} authFailed={authFailed} />
  </div>
</div>
```

#### 1.3 Add StatusText Component

**ADD** new component in ShareHistoryPage.tsx:

```tsx
interface StatusTextProps {
  item: ShareHistoryItem;
  isOnline: boolean;
  authFailed: boolean;
}

function StatusText({ item, isOnline, authFailed }: StatusTextProps): React.JSX.Element {
  // Synced state
  if (item.status === 'synced' && item.syncedAt !== undefined) {
    return (
      <span className="flex items-center gap-1 text-green-600">
        <CheckCircle2 className="h-3 w-3" />
        Synced {formatDate(item.syncedAt)}
      </span>
    );
  }

  // Syncing state
  if (item.status === 'syncing') {
    return (
      <span className="flex items-center gap-1 text-blue-600">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Syncing...
      </span>
    );
  }

  // Pending states
  if (!isOnline) {
    return (
      <span className="flex items-center gap-1 text-slate-500">
        <Clock className="h-3 w-3" />
        Waiting for connection
      </span>
    );
  }

  if (authFailed) {
    return (
      <span className="flex items-center gap-1 text-red-600">
        <AlertCircle className="h-3 w-3" />
        Sign in to sync
      </span>
    );
  }

  // Pending with retry time
  if (item.nextRetryAt !== undefined) {
    const timeUntil = getTimeUntilRetry(item.nextRetryAt);
    if (timeUntil > 0) {
      return (
        <span className="flex items-center gap-1 text-amber-600">
          <Clock className="h-3 w-3" />
          Retry in {formatDuration(timeUntil)}
        </span>
      );
    }
  }

  // Default pending
  return (
    <span className="flex items-center gap-1 text-amber-600">
      <Clock className="h-3 w-3" />
      Pending
    </span>
  );
}
```

#### 1.4 Add Helper Functions

**ADD** in ShareHistoryPage.tsx:

```typescript
function getTimeUntilRetry(nextRetryAt: string): number {
  return Math.max(0, new Date(nextRetryAt).getTime() - Date.now());
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h`;
}
```

#### 1.5 Update Header Section

**REPLACE** the header subtitle with:

```tsx
<p className="text-sm text-slate-500">
  {!isOnline ? (
    <span className="text-amber-600">Offline</span>
  ) : authFailed ? (
    <span className="text-red-600">Sign in to sync</span>
  ) : null}
</p>
```

#### 1.6 Update Context Usage

**CHANGE** the destructuring at top of component:

```typescript
// FROM
const { history, pendingCount, isSyncing, refreshHistory } = useSyncQueue();

// TO
const { history, isSyncing, refreshHistory, isOnline, authFailed } = useSyncQueue();
```

---

### 2. shareQueue.ts Changes

#### 2.1 Update ShareHistoryItem Interface

**ADD** `nextRetryAt` field:

```typescript
export interface ShareHistoryItem {
  id: string;
  contentPreview: string;
  createdAt: string;
  status: ShareStatus;
  syncedAt?: string;
  commandId?: string;
  lastError?: string;
  nextRetryAt?: string; // ADD THIS
}
```

#### 2.2 Update History When Queue Item Changes

**MODIFY** `updateQueueItem` to also update history:

```typescript
export function updateQueueItem(id: string, updates: Partial<ShareQueueItem>): void {
  const queue = getQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index !== -1 && queue[index] !== undefined) {
    queue[index] = { ...queue[index], ...updates };
    saveQueue(queue);

    // Also update history with nextRetryAt
    if (updates.nextRetryAt !== undefined) {
      const history = getHistory();
      const historyIndex = history.findIndex((item) => item.id === id);
      if (historyIndex !== -1 && history[historyIndex] !== undefined) {
        history[historyIndex] = {
          ...history[historyIndex],
          nextRetryAt: updates.nextRetryAt,
          lastError: updates.lastError,
        };
        saveHistory(history);
      }
    }
  }
}
```

#### 2.3 DELETE markAsFailed Function

**DELETE** the entire `markAsFailed` function (lines 133-146). It will no longer be used.

```typescript
// DELETE THIS ENTIRE FUNCTION
export function markAsFailed(id: string, error: string): void {
  // ... all of it
}
```

#### 2.4 Remove 'failed' from ShareStatus

**MODIFY** ShareStatus type:

```typescript
// FROM
export type ShareStatus = 'pending' | 'syncing' | 'synced' | 'failed';

// TO
export type ShareStatus = 'pending' | 'syncing' | 'synced';
```

---

### 3. SyncQueueContext.tsx Changes

#### 3.1 Add New State Variables

**ADD** after existing useState declarations:

```typescript
const [isOnline, setIsOnline] = useState(navigator.onLine);
const [authFailed, setAuthFailed] = useState(false);
```

#### 3.2 Add Online/Offline Listeners

**ADD** new useEffect:

```typescript
useEffect(() => {
  const handleOnline = (): void => {
    setIsOnline(true);
  };
  const handleOffline = (): void => {
    setIsOnline(false);
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return (): void => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}, []);
```

#### 3.3 Clear authFailed on Re-authentication

**ADD** useEffect to detect re-authentication:

```typescript
useEffect(() => {
  if (isAuthenticated && authFailed) {
    setAuthFailed(false);
  }
}, [isAuthenticated, authFailed]);
```

#### 3.4 Update processQueue Error Handling

**ADD** Sentry import at top:

```typescript
import * as Sentry from '@sentry/react';
```

**REPLACE** the catch block in processQueue (the inner try-catch around createCommand):

```typescript
try {
  const command = await createCommand(token, {
    text: item.content,
    source: item.source,
    externalId: item.externalId,
  });

  markAsSynced(item.id, command.id);
  refreshHistory();
} catch (err) {
  const errorMessage = err instanceof Error ? err.message : 'Sync failed';
  const statusCode = getStatusCode(err);

  // 401: Stop processing, wait for re-auth
  if (statusCode === 401) {
    setAuthFailed(true);
    updateHistoryStatus(item.id, 'pending');
    refreshHistory();
    return; // Stop processing entire queue
  }

  // Offline: Skip this item, continue with others
  if (!navigator.onLine) {
    updateHistoryStatus(item.id, 'pending');
    refreshHistory();
    continue;
  }

  // All other errors: Report to Sentry, retry with backoff
  Sentry.captureException(err, {
    tags: { feature: 'share-sync' },
    extra: {
      itemId: item.id,
      retryCount: item.retryCount,
      contentPreview: item.content.slice(0, 50),
    },
  });

  const nextRetryDelay = calculateNextRetryDelay(item.retryCount);
  updateQueueItem(item.id, {
    retryCount: item.retryCount + 1,
    nextRetryAt: new Date(Date.now() + nextRetryDelay).toISOString(),
    lastError: errorMessage,
  });
  updateHistoryStatus(item.id, 'pending');
  refreshHistory();
}
```

#### 3.5 Add getStatusCode Helper

**ADD** helper function (can be inside the file or imported):

```typescript
function getStatusCode(error: unknown): number | null {
  if (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  return null;
}
```

#### 3.6 Add Early Return for Offline/AuthFailed

**MODIFY** processQueue early return:

```typescript
// FROM
if (!isAuthenticated || isSyncingRef.current) return;

// TO
if (!isAuthenticated || isSyncingRef.current || !navigator.onLine || authFailed) return;
```

#### 3.7 Update Context Value

**MODIFY** the useMemo value:

```typescript
const value = useMemo(
  (): SyncQueueContextValue => ({
    pendingCount,
    history,
    addShare,
    refreshHistory,
    isSyncing,
    isOnline, // ADD
    authFailed, // ADD
  }),
  [pendingCount, history, addShare, refreshHistory, isSyncing, isOnline, authFailed]
);
```

#### 3.8 Update Interface

**MODIFY** SyncQueueContextValue interface:

```typescript
interface SyncQueueContextValue {
  pendingCount: number;
  history: ShareHistoryItem[];
  addShare: (content: string) => void;
  refreshHistory: () => void;
  isSyncing: boolean;
  isOnline: boolean; // ADD
  authFailed: boolean; // ADD
}
```

#### 3.9 Remove markAsFailed Import

**REMOVE** from imports:

```typescript
// FROM
import {
  addToQueue,
  calculateNextRetryDelay,
  getHistory,
  getQueue,
  isClientError, // REMOVE
  isRetryDue,
  markAsFailed, // REMOVE
  markAsSynced,
  updateHistoryStatus,
  updateQueueItem,
  type ShareHistoryItem,
} from '../services/shareQueue.js';

// TO
import {
  addToQueue,
  calculateNextRetryDelay,
  getHistory,
  getQueue,
  isRetryDue,
  markAsSynced,
  updateHistoryStatus,
  updateQueueItem,
  type ShareHistoryItem,
} from '../services/shareQueue.js';
```

---

### 4. Header.tsx Changes

#### 4.1 Update Context Usage

**MODIFY** destructuring:

```typescript
// FROM
const { pendingCount, isSyncing } = useSyncQueue();

// TO
const { pendingCount, isSyncing, isOnline, authFailed } = useSyncQueue();
```

#### 4.2 Update Sync Indicator

**REPLACE** the sync indicator rendering:

```tsx
// FROM
{
  pendingCount > 0 && (
    <Link
      to="/settings/share-history"
      className="flex items-center justify-center rounded-lg p-2 text-sm transition-colors hover:bg-slate-100"
      title={`${String(pendingCount)} pending - click to view history`}
    >
      <RefreshCw
        className={`h-4 w-4 text-amber-500 ${isSyncing ? 'animate-spin' : 'animate-pulse'}`}
      />
    </Link>
  );
}

// TO
{
  pendingCount > 0 && (
    <Link
      to="/settings/share-history"
      className="flex items-center justify-center rounded-lg p-2 text-sm transition-colors hover:bg-slate-100"
      title={
        !isOnline
          ? 'Offline - click to view history'
          : authFailed
            ? 'Sign in to sync - click to view history'
            : `${String(pendingCount)} pending - click to view history`
      }
    >
      <RefreshCw
        className={`h-4 w-4 ${
          !isOnline || authFailed
            ? 'text-slate-400'
            : isSyncing
              ? 'text-amber-500 animate-spin'
              : 'text-amber-500 animate-pulse'
        }`}
      />
    </Link>
  );
}
```

---

## Test Requirements

### Backend Tests

N/A - no backend changes.

### Frontend Tests (`apps/web/src/__tests__/`)

| Test File                   | Test Case                                 | Scenario                         | Expected                             |
| --------------------------- | ----------------------------------------- | -------------------------------- | ------------------------------------ |
| `shareQueue.test.ts`        | updateQueueItem updates history           | Call with nextRetryAt            | History item gets nextRetryAt        |
| `shareQueue.test.ts`        | ShareStatus type                          | Type check                       | No 'failed' status                   |
| `SyncQueueContext.test.tsx` | 401 sets authFailed                       | Mock 401 response                | authFailed becomes true, queue stops |
| `SyncQueueContext.test.tsx` | Re-auth clears authFailed                 | isAuthenticated after authFailed | authFailed becomes false             |
| `SyncQueueContext.test.tsx` | Offline skips sync                        | navigator.onLine = false         | processQueue returns early           |
| `SyncQueueContext.test.tsx` | Non-401 error reports to Sentry           | Mock 500 response                | Sentry.captureException called       |
| `SyncQueueContext.test.tsx` | Context exposes isOnline                  | Render provider                  | isOnline in context value            |
| `SyncQueueContext.test.tsx` | Context exposes authFailed                | Render provider                  | authFailed in context value          |
| `ShareHistoryPage.test.tsx` | StatusText shows "Synced"                 | item.status = 'synced'           | Green text with checkmark            |
| `ShareHistoryPage.test.tsx` | StatusText shows "Syncing"                | item.status = 'syncing'          | Blue text with spinner               |
| `ShareHistoryPage.test.tsx` | StatusText shows "Retry in X"             | Pending with future nextRetryAt  | Amber text with time                 |
| `ShareHistoryPage.test.tsx` | StatusText shows "Waiting for connection" | isOnline = false                 | Slate text                           |
| `ShareHistoryPage.test.tsx` | StatusText shows "Sign in to sync"        | authFailed = true                | Red text                             |
| `ShareHistoryPage.test.tsx` | Long URL doesn't overflow                 | Render long URL                  | Has break-all class                  |
| `Header.test.tsx`           | Sync icon grey when offline               | isOnline = false                 | text-slate-400 class                 |
| `Header.test.tsx`           | Sync icon grey when authFailed            | authFailed = true                | text-slate-400 class                 |

---

## Migration Notes

- No database migrations required
- No API changes required
- Backward compatible with existing localStorage data
- Items with status='failed' in existing history will display as 'pending' (acceptable)

---

## Checklist for Implementation

- [ ] Update `shareQueue.ts` - add nextRetryAt to interface, update updateQueueItem, remove markAsFailed, remove 'failed' from ShareStatus
- [ ] Update `SyncQueueContext.tsx` - add isOnline/authFailed state, update processQueue, add Sentry reporting
- [ ] Update `ShareHistoryPage.tsx` - remove StatusBadge, add StatusText, update layout with break-all
- [ ] Update `Header.tsx` - update sync indicator
- [ ] Write tests for all new functionality
- [ ] Manual testing on mobile device with long URLs
- [ ] Verify Sentry errors appear in dashboard
