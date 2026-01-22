# Task 4-1: Create Linear Connection Page

## Tier

4 (Web App)

## Context

API client is ready. Now create the connection page for configuring Linear integration.

## Problem Statement

Need to create LinearConnectionPage component that:

1. Shows current connection status
2. Allows entering API key
3. Validates key and shows available teams
4. Saves connection with selected team
5. Allows disconnecting

## Scope

### In Scope

- `apps/web/src/pages/LinearConnectionPage.tsx`
- Connection status display
- API key input and validation
- Team selection dropdown
- Save and disconnect functionality

### Out of Scope

- Issues dashboard (next task)
- Navigation updates (later task)

## Required Approach

1. **Study** `apps/web/src/pages/GoogleCalendarConnectionPage.tsx`
2. **Create** similar page structure for Linear
3. **Use** existing UI components (Button, Card, Layout)
4. **Handle** loading and error states

## Step Checklist

- [ ] Create `apps/web/src/pages/LinearConnectionPage.tsx`
- [ ] Implement connection status display
- [ ] Implement API key input with validation
- [ ] Implement team selection after validation
- [ ] Implement save connection flow
- [ ] Implement disconnect flow
- [ ] Export from `apps/web/src/pages/index.ts`
- [ ] TypeCheck web app

## Definition of Done

- Page renders correctly
- API key validation works
- Team selection works
- Save/disconnect works
- TypeScript compiles

## Verification Commands

```bash
cd apps/web
pnpm run typecheck
cd ../..
```

## Rollback Plan

```bash
rm apps/web/src/pages/LinearConnectionPage.tsx
```

## Reference Files

- `apps/web/src/pages/GoogleCalendarConnectionPage.tsx`
- `apps/web/src/pages/NotionConnectionPage.tsx`

## LinearConnectionPage.tsx

```tsx
import { useState, useEffect } from 'react';
import { Link2, CheckCircle, XCircle, AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/hooks';
import {
  getLinearConnection,
  validateLinearApiKey,
  saveLinearConnection,
  disconnectLinear,
} from '@/services';
import type { LinearConnectionStatus, LinearTeam } from '@/types';

type ConnectionState = 'loading' | 'disconnected' | 'connected' | 'configuring';

export function LinearConnectionPage(): React.JSX.Element {
  const { accessToken } = useAuth();
  const [state, setState] = useState<ConnectionState>('loading');
  const [connection, setConnection] = useState<LinearConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Configuration form state
  const [apiKey, setApiKey] = useState('');
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (accessToken === null) return;
    loadConnectionStatus();
  }, [accessToken]);

  async function loadConnectionStatus(): Promise<void> {
    if (accessToken === null) return;

    try {
      setState('loading');
      const status = await getLinearConnection(accessToken);
      setConnection(status);

      if (status?.connected === true) {
        setState('connected');
      } else {
        setState('disconnected');
      }
    } catch (err) {
      setError('Failed to load connection status');
      setState('disconnected');
    }
  }

  async function handleValidateApiKey(): Promise<void> {
    if (accessToken === null || apiKey.trim() === '') return;

    try {
      setValidating(true);
      setError(null);
      const fetchedTeams = await validateLinearApiKey(accessToken, apiKey.trim());
      setTeams(fetchedTeams);

      if (fetchedTeams.length > 0 && fetchedTeams[0] !== undefined) {
        setSelectedTeamId(fetchedTeams[0].id);
      }
    } catch (err) {
      setError('Invalid API key. Please check and try again.');
      setTeams([]);
    } finally {
      setValidating(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (accessToken === null || selectedTeamId === '') return;

    const selectedTeam = teams.find((t) => t.id === selectedTeamId);
    if (selectedTeam === undefined) return;

    try {
      setSaving(true);
      setError(null);
      const status = await saveLinearConnection(
        accessToken,
        apiKey.trim(),
        selectedTeam.id,
        selectedTeam.name
      );
      setConnection(status);
      setState('connected');
      setApiKey('');
      setTeams([]);
    } catch (err) {
      setError('Failed to save connection');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(): Promise<void> {
    if (accessToken === null) return;

    try {
      setSaving(true);
      await disconnectLinear(accessToken);
      setConnection(null);
      setState('disconnected');
    } catch (err) {
      setError('Failed to disconnect');
    } finally {
      setSaving(false);
    }
  }

  function handleStartConfiguring(): void {
    setState('configuring');
    setError(null);
    setApiKey('');
    setTeams([]);
    setSelectedTeamId('');
  }

  function handleCancelConfiguring(): void {
    setState(connection?.connected === true ? 'connected' : 'disconnected');
    setApiKey('');
    setTeams([]);
    setError(null);
  }

  if (state === 'loading') {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Linear Connection</h2>
        <p className="text-slate-600">
          Connect your Linear workspace to create issues via voice commands.
        </p>
      </div>

      {error !== null && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Card className="p-6">
        {state === 'connected' && connection !== null && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Connected to Linear</h3>
                <p className="text-sm text-slate-500">Team: {connection.teamName ?? 'Unknown'}</p>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-600">
                You can now create Linear issues by saying things like:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                <li>"Create linear issue for dark mode feature"</li>
                <li>"Nowe zadanie w Linear: napraw walidację"</li>
                <li>"Add to Linear: fix login button"</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={handleStartConfiguring}>
                Reconfigure
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={(): void => {
                  void handleDisconnect();
                }}
                disabled={saving}
                isLoading={saving}
              >
                Disconnect
              </Button>
            </div>
          </div>
        )}

        {state === 'disconnected' && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <XCircle className="h-6 w-6 text-slate-400" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Not Connected</h3>
                <p className="text-sm text-slate-500">
                  Connect your Linear workspace to get started.
                </p>
              </div>
            </div>

            <Button type="button" onClick={handleStartConfiguring}>
              <Link2 className="mr-2 h-4 w-4" />
              Connect Linear
            </Button>
          </div>
        )}

        {state === 'configuring' && (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-slate-900">Connect Linear</h3>
              <p className="text-sm text-slate-500">
                Enter your Linear Personal API key. You can create one at{' '}
                <a
                  href="https://linear.app/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  linear.app/settings/api
                  <ExternalLink className="ml-1 inline h-3 w-3" />
                </a>
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">API Key</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e): void => {
                      setApiKey(e.target.value);
                      setTeams([]);
                    }}
                    placeholder="lin_api_..."
                    className="flex-1 rounded-lg border border-slate-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={(): void => {
                      void handleValidateApiKey();
                    }}
                    disabled={validating || apiKey.trim() === ''}
                    isLoading={validating}
                  >
                    Validate
                  </Button>
                </div>
              </div>

              {teams.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700">Select Team</label>
                  <select
                    value={selectedTeamId}
                    onChange={(e): void => {
                      setSelectedTeamId(e.target.value);
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name} ({team.key})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                type="button"
                onClick={(): void => {
                  void handleSave();
                }}
                disabled={saving || teams.length === 0 || selectedTeamId === ''}
                isLoading={saving}
              >
                Save Connection
              </Button>
              <Button type="button" variant="ghost" onClick={handleCancelConfiguring}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>
    </Layout>
  );
}
```

## Update pages/index.ts

Add export:

```typescript
export { LinearConnectionPage } from './LinearConnectionPage.js';
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
