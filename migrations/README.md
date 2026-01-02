# Firestore Database Migrations

Database migrations for Firestore indexes, rules, and data.

## Creating a Migration

1. Create a new file: `NNN_descriptive-name.mjs` where NNN is the next sequential ID
2. Export required `metadata` object and `up` function

```javascript
export const metadata = {
  id: '003',                           // Must match filename ID
  name: 'add-user-index',              // Descriptive name
  description: 'Add composite index for user queries',
  createdAt: '2026-01-15',
};

export async function up(context) {
  // context.firestore - Firestore instance
  // context.projectId - Target project ID
  // context.repoRoot - Repository root path
  // context.deployIndexes() - Deploy firestore.indexes.json
  // context.deployRules() - Deploy firestore.rules

  await context.firestore.doc('collection/doc').set({ ... });
}
```

## Running Migrations

```bash
# Run pending migrations
npm run migrate

# Show migration status
npm run migrate:status

# Preview without applying
node scripts/migrate.mjs --dry-run

# Target specific project
node scripts/migrate.mjs --project intexuraos-dev
```

## Migration Types

### Data Migrations

Set or update Firestore documents:

```javascript
export async function up(context) {
  await context.firestore.doc('app_settings/config').set({
    feature: true,
    version: 2,
  });
}
```

### Index Deployments

Deploy Firestore indexes (uses Firebase CLI):

```javascript
export async function up(context) {
  await context.deployIndexes();
}
```

### Rules Deployments

Deploy Firestore security rules:

```javascript
export async function up(context) {
  await context.deployRules();
}
```

## Guidelines

- **Forward-only**: No rollback mechanism - plan migrations carefully
- **Idempotent**: Migrations should be safe to re-run (use `.set()` over `.update()`)
- **Sequential**: IDs must be sequential with no gaps (001, 002, 003)
- **Descriptive**: Use clear names that describe the change

## Tracking

Applied migrations are tracked in the `_migrations` Firestore collection with:

- `id` - Migration ID
- `name` - Migration name
- `status` - `applied` or `failed`
- `appliedAt` - ISO timestamp
- `durationMs` - Execution time
- `checksum` - SHA256 of file content
- `error` - Error message (if failed)
