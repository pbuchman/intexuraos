# Firestore Database Migrations

Database migrations for Firestore indexes, rules, and data.

## Creating a Migration

1. Create a new file: `NNN_descriptive-name.mjs` where NNN is the next sequential ID
2. Export required `metadata` object and `up` function
3. Optionally export `indexes` and `rules` for Firestore config

```javascript
export const metadata = {
  id: '009',
  name: 'add-user-index',
  description: 'Add composite index for user queries',
  createdAt: '2026-01-15',
};

// Optional: Define new indexes (aggregated with previous migrations)
export const indexes = [
  {
    collectionGroup: 'users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];

// Optional: Define new security rules (merged with previous migrations)
export const rules = {
  collections: {
    'users/{userId}': {
      comment: 'User documents',
      get: 'isOwner(resource.data.userId)',
      list: 'isAuthenticated() && request.query.limit <= 100',
      write: 'false',
    },
  },
};

export async function up(context) {
  // Deploy indexes and rules (generates files from all migrations)
  await context.deployIndexes();
  await context.deployRules();

  // Optional: data migration
  await context.firestore.doc('collection/doc').set({ ... });
}
```

## Running Migrations

```bash
# Run pending migrations
pnpm run migrate

# Show migration status
ppnpm run migrate:status

# Preview without applying
node scripts/migrate.mjs --dry-run

# Target specific project
node scripts/migrate.mjs --project intexuraos-dev
```

## How Indexes & Rules Work

Indexes and rules are **aggregated** from all migrations:

1. Migration runner loads all `migrations/*.mjs` files in order
2. Aggregates all `indexes` arrays (deduplicates identical entries)
3. Merges all `rules.functions` and `rules.collections` objects
4. Generates `firestore.indexes.json` and `firestore.rules` files
5. Deploys via Firebase CLI

**Note:** The generated files are in `.gitignore` - source of truth is the migrations.

## Rules Structure

```javascript
export const rules = {
  // Shared functions (defined once, in first migration)
  functions: {
    isAuthenticated: 'return request.auth != null;',
    isOwner: 'return isAuthenticated() && request.auth.uid == userId;',
  },

  // Collection rules (each migration can add new collections)
  collections: {
    'collectionName/{docId}': {
      comment: 'Optional comment above the match block',
      get: 'isOwner(resource.data.userId)',
      list: 'isAuthenticated() && request.query.limit <= 100',
      listComment: 'Optional comment above allow list',
      write: 'false',
      writeComment: 'Optional comment above allow write',
    },
    // Catch-all rule (automatically placed last in output)
    '{document=**}': {
      comment: 'Block all other collections',
      read: 'false',
      write: 'false',
    },
  },
};
```

## Guidelines

- **Forward-only**: No rollback mechanism - plan migrations carefully
- **Idempotent**: Migrations should be safe to re-run
- **Sequential**: IDs must be sequential with no gaps (001, 002, 003)
- **Additive**: Each migration adds to previous - don't repeat existing indexes/rules
- **Immutable**: Applied migrations cannot be modified (checksum validation enforced)

## Tracking

Applied migrations are tracked in the `_migrations` Firestore collection with:

- `id` - Migration ID
- `name` - Migration name
- `status` - `applied` or `failed`
- `appliedAt` - ISO timestamp
- `durationMs` - Execution time
- `checksum` - SHA256 of file content
- `error` - Error message (if failed)
