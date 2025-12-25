---
applyTo: 'apps/web/**'
---

# Web App Instructions

**Verification:** `npm run ci` from repo root.

---

## Hosting & Routing (IMPORTANT)

The web app is deployed as static assets to GCS (`gs://intexuraos-web-${ENVIRONMENT}`) and served via an external HTTP(S) Load Balancer using a backend bucket.

### Link format requirement

Backend buckets do **not** support a general "SPA fallback" rewrite (e.g. `/notion` → `/index.html`).

To ensure links work in development and production under this hosting model:

- Use **hash routing** URLs (e.g. `/#/notion`, not `/notion`).
- Do not introduce new routes that assume server-side rewrites.

**Implementation:** `apps/web/src/App.tsx` uses `HashRouter`.

Reference: `docs/architecture/web-app-hosting.md`

---

## Architecture

### Single Responsibility Principle (SRP)

- Each module/file has ONE clear responsibility.
- If a file does multiple unrelated things, split it.
- Naming should reflect the single purpose.

### Component Structure

- Components in `/apps/web/src/components/`.
- Reusable UI in `/apps/web/src/components/ui/`.
- Keep components **focused and minimal**.
- If a component exceeds ~150 lines, consider splitting.
- Extract repeated patterns into shared UI components.

### State Management

- Context providers in `/apps/web/src/context/`.
- Hooks in `/apps/web/src/hooks/`.
- Avoid prop drilling beyond 2 levels.

### Page Components

- Pages in `/apps/web/src/pages/`.
- Each page is a route target.
- Pages compose layout and feature components.

### API Integration

- Service clients in `/apps/web/src/services/`.
- All API calls go through typed service clients.
- Use `useApiClient` hook for authenticated requests.

---

## Authentication Rules

- Use `@auth0/auth0-react` SDK for SPA authentication.
- Never store tokens in localStorage directly — SDK handles it.
- Protected routes must check `isAuthenticated` from `useAuth`.
- Login redirects through Auth0 Universal Login.

---

## TypeScript Rules

- Zero `tsc` errors.
- `any` forbidden without inline justification.
- Prefer explicit, narrow types.
- No `@ts-ignore` or `@ts-expect-error`.
- All API response types must be explicitly defined.

---

## Code Quality

### No Obvious Comments

- Comments explain **why**, not **what**.
- Do not add comments that restate the code.
- Delete worthless comments.

### No Magic Strings

- Extract constants or use configuration.
- Environment variables are exposed to the client via `envPrefix: 'INTEXURAOS_'` in Vite.
  - Prefer `import.meta.env.INTEXURAOS_*`.

---

## Styling Rules

- TailwindCSS for all styling.
- No inline style objects.
- Color palette: blue primary (`blue-600`), yellow accents (`amber-400`).
- Consistent spacing using Tailwind scale.

---

## Testing Requirements

### What MUST Be Tested

- Custom hooks
- Context providers
- API service clients (mocked fetch)
- Page-level user interactions
- Form validation logic

### Coverage Targets

- **80%+ line coverage** for hooks and services.
- Test all error states and edge cases.

---

## Verification Commands

Run from repo root:

```bash
npm run typecheck     # Zero errors required
npm run lint          # Zero warnings required
npm run test          # All tests pass
npm run ci            # Full CI check
```

---

## Task Completion Checklist

**When you finish a task in `/apps/web`, verify:**

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] Logic changes have corresponding tests
- [ ] No `any` without documented justification
- [ ] No new ESLint or TS warnings
- [ ] Components are minimal and focused (SRP)
- [ ] Files follow single responsibility principle
- [ ] Any new links/routes use hash routing (`/#/...`) so they work under static hosting

**Verification is not optional.**
