# Task 4-3: Add Web App Routes and Navigation

## Tier

4 (Web App)

## Context

Pages are created. Now add routes and navigation links.

## Problem Statement

Need to:

1. Add routes to App.tsx for Linear pages
2. Add navigation links in sidebar/menu
3. Update Cloud Build for web app if needed

## Scope

### In Scope

- Add routes to `apps/web/src/App.tsx`
- Add navigation links in sidebar
- Update Cloud Build CLOUD_RUN_SERVICES if needed

### Out of Scope

- Additional styling
- Mobile menu updates

## Required Approach

1. **Study** `apps/web/src/App.tsx` for routing patterns
2. **Add** routes following existing patterns
3. **Find** navigation component and add links
4. **Update** Cloud Build if web needs linear-agent URL

## Step Checklist

- [ ] Add routes to `apps/web/src/App.tsx`
- [ ] Add navigation links (find sidebar/nav component)
- [ ] Check if web Cloud Build needs CLOUD_RUN_SERVICES update
- [ ] TypeCheck and verify routing works

## Definition of Done

- Routes navigate correctly
- Navigation links visible
- Web app compiles

## Verification Commands

```bash
cd apps/web
pnpm run typecheck
cd ../..
```

## Rollback Plan

```bash
git checkout apps/web/src/App.tsx
git checkout apps/web/src/components/  # navigation files
```

## Reference Files

- `apps/web/src/App.tsx`
- Find navigation component in `apps/web/src/components/`

## App.tsx route additions

Add imports:

```typescript
import { LinearConnectionPage, LinearIssuesPage } from './pages/index.js';
```

Add routes (follow existing pattern - look for `/#/calendar` route):

```tsx
<Route path="/linear" element={<LinearIssuesPage />} />
<Route path="/linear/connection" element={<LinearConnectionPage />} />
```

## Navigation link additions

Find the sidebar/navigation component and add links similar to:

```tsx
<NavLink to="/linear" icon={<LayoutList />}>
  Linear Issues
</NavLink>
```

Look for where calendar link is defined and add linear nearby in integrations section.

## Cloud Build check

Check `apps/web/cloudbuild.yaml` and `cloudbuild/cloudbuild.yaml` for `CLOUD_RUN_SERVICES` array.

If web app needs to call linear-agent directly (it does for API calls), add:

```bash
"linear-agent:LINEAR_AGENT"
```

This will set `INTEXURAOS_LINEAR_AGENT_URL` environment variable at build time.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
