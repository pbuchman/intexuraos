# 2-0: Web UI Dropdown

## Objective

Add type selector dropdown to `ActionDetailModal` for pending/awaiting_approval actions.

## Tasks

### 1. Update actionsApi.ts

File: `apps/web/src/services/actionsApi.ts`

Update `updateAction` or create `updateActionType`:

```typescript
export async function updateAction(
  actionId: string,
  updates: {
    status?: 'processing' | 'rejected' | 'archived';
    type?: ActionType;
  }
): Promise<Action> {
  const response = await apiClient.patch(`/actions/${actionId}`, updates);
  return response.data.data.action;
}
```

Note: `commandText` is NOT sent from frontend — backend fetches it from commands-router.

### 2. Update ActionDetailModal.tsx

File: `apps/web/src/components/ActionDetailModal.tsx`

Add dropdown after the type badge (lines 109-114):

```tsx
const ACTION_TYPES: ActionType[] = ['todo', 'research', 'note', 'link', 'calendar', 'reminder'];

// State for type editing
const [selectedType, setSelectedType] = useState(action.type);
const [isChangingType, setIsChangingType] = useState(false);

const canChangeType = action.status === 'pending' || action.status === 'awaiting_approval';

const handleTypeChange = async (newType: ActionType) => {
  if (newType === action.type) return;

  setIsChangingType(true);
  try {
    await updateAction(action.id, { type: newType });
    setSelectedType(newType);
    // Optionally trigger refresh or update local state
  } catch (error) {
    // Handle error
  } finally {
    setIsChangingType(false);
  }
};
```

UI placement (in header area, after type badge):

```tsx
{
  canChangeType ? (
    <select
      value={selectedType}
      onChange={(e) => handleTypeChange(e.target.value as ActionType)}
      disabled={isChangingType}
      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
    >
      {ACTION_TYPES.map((t) => (
        <option key={t} value={t}>
          {t.charAt(0).toUpperCase() + t.slice(1)}
        </option>
      ))}
    </select>
  ) : (
    <span className="...existing badge styles...">{getTypeLabel(action.type)}</span>
  );
}
```

### 3. Consider UX improvements

- Show confidence only for original classification
- Add visual indicator when type was changed vs original
- Disable dropdown while type change is in progress
- Show toast/feedback on successful type change

### 4. Update Action type in frontend

Ensure `Action` type in `apps/web/src/types/index.ts` matches backend.

## Verification

- [ ] Dropdown appears for pending/awaiting_approval actions
- [ ] Dropdown hidden for other statuses
- [ ] Type change triggers API call (no commandText — backend fetches)
- [ ] UI updates after successful type change
- [ ] Loading state shown during change
- [ ] Error handling works

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
