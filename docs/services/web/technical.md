# Web App Technical Reference

The web app is a Vite/React PWA that talks to public service API paths generated from `apps/web/service-manifest.json`.

## Service URL Generation

Run `pnpm run generate:service-wiring` after service manifest changes. The generator writes `apps/web/src/config.generated.ts` and production service URL variables.

## Removed UI

The old command/action inbox, action detail modals, command detail modals, and action-config executor have been removed. Current navigation starts from the dashboard, code tasks, sessions, integrations, notes, bookmarks, research, calendar, Linear, and settings.

## Runtime Checks

- `pnpm --filter @intexuraos/web test`
- `pnpm --filter @intexuraos/web typecheck`
- `pnpm --filter @intexuraos/web lint`
- `pnpm run verify:service-wiring`

