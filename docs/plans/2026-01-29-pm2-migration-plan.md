# PM2 Migration Plan

**Status:** Draft
**Created:** 2026-01-29
**Linear Issue:** [INT-423](https://linear.app/pbuchman/issue/INT-423)

---

## Overview

Migrate local development from custom `scripts/dev.mjs` to PM2 process manager. This is a prerequisite for the pre-dev cloud environment (INT-423).

### Goals

1. Replace `pnpm run dev` with PM2-based workflow
2. Gain crash recovery (auto-restart on failure)
3. Better log aggregation and monitoring
4. Prepare for pre-dev VM deployment

### Non-Goals

- Changing how services work internally
- Modifying service code
- Changing emulator setup (Docker Compose stays)

---

## Current State Analysis

### What dev.mjs Does

| Feature                     | Implementation                                 | Keep/Replace                |
| --------------------------- | ---------------------------------------------- | --------------------------- |
| Port conflict checking      | `checkPortInUse()`                             | Keep (pre-flight)           |
| Env var validation          | `validateEnvVars()`                            | Keep (pre-flight)           |
| Firestore config generation | `generateFirestoreConfig()`                    | Keep (pre-flight)           |
| Firestore data sync         | `syncFirestore()`                              | Keep (pre-flight)           |
| Start emulators             | `docker compose up -d`                         | Keep (pre-flight)           |
| Wait for emulators          | `waitForEmulators()`                           | Keep (pre-flight)           |
| Start services              | `spawn('pnpm', ['exec', 'tsx', 'watch', ...])` | **Replace with PM2**        |
| Start web app               | `spawn('pnpm', ['run', 'dev'])`                | **Replace with PM2**        |
| TUI dashboard               | blessed library                                | **Replace with pm2 monit**  |
| Log aggregation             | Custom log() function                          | **Replace with pm2 logs**   |
| Health polling              | `pollHealth()`                                 | **Replace with PM2 status** |
| Graceful shutdown           | SIGINT/SIGTERM handlers                        | **PM2 handles this**        |
| Crash recovery              | None (just logs exit)                          | **PM2 autorestart**         |

### Services to Migrate

From `scripts/dev.mjs` SERVICES array:

| Service                      | Port | Notes                   |
| ---------------------------- | ---- | ----------------------- |
| app-settings-service         | 8122 |                         |
| notion-service               | 8112 |                         |
| whatsapp-service             | 8113 |                         |
| mobile-notifications-service | 8114 |                         |
| commands-agent               | 8117 |                         |
| actions-agent                | 8118 |                         |
| notes-agent                  | 8121 |                         |
| todos-agent                  | 8123 |                         |
| bookmarks-agent              | 8124 |                         |
| calendar-agent               | 8125 |                         |
| linear-agent                 | 8126 |                         |
| code-agent                   | 8128 |                         |
| web-agent                    | 8127 |                         |
| user-service                 | 8110 | Depends on app-settings |
| research-agent               | 8116 | Depends on app-settings |
| data-insights-agent          | 8119 | Depends on app-settings |
| image-service                | 8120 | Depends on app-settings |
| **web**                      | 3000 | Vite dev server         |

---

## Target Architecture

### New File Structure

```
/
├── ecosystem.config.js          # PM2 service definitions (NEW)
├── scripts/
│   ├── dev-setup.mjs            # Emulators + env validation (NEW)
│   ├── dev.mjs                  # DEPRECATED → DELETE after migration
│   └── dev-ui.mjs               # DEPRECATED → DELETE after migration
└── package.json                 # Updated scripts
```

### New Workflow

```bash
# One-time setup (emulators, env validation)
pnpm run dev:setup

# Start all services with PM2
pm2 start ecosystem.config.js

# Monitor (TUI with CPU, memory, restarts)
pm2 monit

# View logs (all or single service)
pm2 logs
pm2 logs research-agent

# Status table
pm2 status

# Restart a service
pm2 restart user-service

# Stop all
pm2 stop all

# Full cleanup
pm2 delete all
```

### Convenience Scripts (package.json)

```json
{
  "scripts": {
    "dev": "pnpm run dev:setup && pm2 start ecosystem.config.js && pm2 logs",
    "dev:setup": "node scripts/dev-setup.mjs",
    "dev:start": "pm2 start ecosystem.config.js",
    "dev:stop": "pm2 stop all",
    "dev:logs": "pm2 logs",
    "dev:status": "pm2 status",
    "dev:monit": "pm2 monit"
  }
}
```

---

## Implementation Steps

### Step 1: Install PM2

```bash
pnpm add -D pm2
```

### Step 2: Create ecosystem.config.js

```javascript
// ecosystem.config.js
import { config } from 'dotenv';

// Load environment from .envrc.local
config({ path: '.envrc.local' });

const COMMON_ENV = {
  NODE_ENV: 'development',
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  INTEXURAOS_GCP_PROJECT_ID: process.env.INTEXURAOS_GCP_PROJECT_ID,
  FIRESTORE_EMULATOR_HOST: 'localhost:8101',
  PUBSUB_EMULATOR_HOST: 'localhost:8102',
  STORAGE_EMULATOR_HOST: 'localhost:8103',
  FIREBASE_AUTH_EMULATOR_HOST: 'localhost:8104',

  // Auth
  INTEXURAOS_AUTH_JWKS_URL: process.env.INTEXURAOS_AUTH_JWKS_URL,
  INTEXURAOS_AUTH_ISSUER: process.env.INTEXURAOS_AUTH_ISSUER,
  INTEXURAOS_AUTH_AUDIENCE: process.env.INTEXURAOS_AUTH_AUDIENCE,
  INTEXURAOS_AUTH0_DOMAIN: process.env.INTEXURAOS_AUTH0_DOMAIN,
  INTEXURAOS_AUTH0_CLIENT_ID: process.env.INTEXURAOS_AUTH0_CLIENT_ID,
  INTEXURAOS_INTERNAL_AUTH_TOKEN: process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN ?? 'local-dev-token',
  INTEXURAOS_WEB_APP_URL: 'http://localhost:3000',

  // Service URLs (all services get all URLs)
  INTEXURAOS_USER_SERVICE_URL: 'http://localhost:8110',
  INTEXURAOS_NOTION_SERVICE_URL: 'http://localhost:8112',
  INTEXURAOS_WHATSAPP_SERVICE_URL: 'http://localhost:8113',
  INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL: 'http://localhost:8114',
  INTEXURAOS_RESEARCH_AGENT_URL: 'http://localhost:8116',
  INTEXURAOS_COMMANDS_AGENT_URL: 'http://localhost:8117',
  INTEXURAOS_ACTIONS_AGENT_URL: 'http://localhost:8118',
  INTEXURAOS_DATA_INSIGHTS_AGENT_URL: 'http://localhost:8119',
  INTEXURAOS_IMAGE_SERVICE_URL: 'http://localhost:8120',
  INTEXURAOS_NOTES_AGENT_URL: 'http://localhost:8121',
  INTEXURAOS_APP_SETTINGS_SERVICE_URL: 'http://localhost:8122',
  INTEXURAOS_TODOS_AGENT_URL: 'http://localhost:8123',
  INTEXURAOS_BOOKMARKS_AGENT_URL: 'http://localhost:8124',
  INTEXURAOS_CALENDAR_AGENT_URL: 'http://localhost:8125',
  INTEXURAOS_LINEAR_AGENT_URL: 'http://localhost:8126',
  INTEXURAOS_WEB_AGENT_URL: 'http://localhost:8127',
  INTEXURAOS_CODE_AGENT_URL: 'http://localhost:8128',
};

// Service-specific env vars
const SERVICE_SPECIFIC = {
  'research-agent': {
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'whatsapp-send-message',
    INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC: 'research-process',
    INTEXURAOS_PUBSUB_LLM_CALL_TOPIC: 'llm-call',
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL: 'http://localhost:3000',
    INTEXURAOS_SHARED_CONTENT_BUCKET: 'intexuraos-shared-content',
    INTEXURAOS_SHARE_BASE_URL: 'http://localhost:3000',
  },
  'whatsapp-service': {
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'whatsapp-send-message',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION: 'whatsapp-send-message-sub',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC: 'whatsapp-media-cleanup',
    INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC: 'commands-ingest',
    INTEXURAOS_WHATSAPP_ACCESS_TOKEN: process.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN,
    INTEXURAOS_WHATSAPP_APP_SECRET: process.env.INTEXURAOS_WHATSAPP_APP_SECRET,
    INTEXURAOS_WHATSAPP_WABA_ID: process.env.INTEXURAOS_WHATSAPP_WABA_ID,
    INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID: process.env.INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID,
    INTEXURAOS_WHATSAPP_VERIFY_TOKEN: process.env.INTEXURAOS_WHATSAPP_VERIFY_TOKEN ?? 'test-token',
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET: 'whatsapp-media',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION: 'whatsapp-media-cleanup-sub',
    INTEXURAOS_SPEECHMATICS_API_KEY: process.env.INTEXURAOS_SPEECHMATICS_API_KEY,
    INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC: 'whatsapp-webhook-process',
    INTEXURAOS_PUBSUB_TRANSCRIPTION_TOPIC: 'whatsapp-transcription',
    INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC: 'approval-reply',
  },
  // ... (other service-specific configs from dev.mjs SERVICE_ENV_MAPPINGS)
};

function createServiceConfig(name, port, extraEnv = {}) {
  return {
    name,
    script: 'pnpm',
    args: ['exec', 'tsx', 'watch', 'src/index.ts'],
    cwd: `./apps/${name}`,
    env: {
      ...COMMON_ENV,
      ...(SERVICE_SPECIFIC[name] || {}),
      ...extraEnv,
      PORT: port,
    },
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000,
    watch: false, // tsx watch handles file watching
    log_date_format: 'HH:mm:ss',
  };
}

module.exports = {
  apps: [
    // Services without dependencies (start first)
    createServiceConfig('app-settings-service', 8122),
    createServiceConfig('notion-service', 8112),
    createServiceConfig('whatsapp-service', 8113),
    createServiceConfig('mobile-notifications-service', 8114),
    createServiceConfig('commands-agent', 8117),
    createServiceConfig('actions-agent', 8118),
    createServiceConfig('notes-agent', 8121),
    createServiceConfig('todos-agent', 8123),
    createServiceConfig('bookmarks-agent', 8124),
    createServiceConfig('calendar-agent', 8125),
    createServiceConfig('linear-agent', 8126),
    createServiceConfig('code-agent', 8128),
    createServiceConfig('web-agent', 8127),

    // Services that depend on app-settings-service
    createServiceConfig('user-service', 8110),
    createServiceConfig('research-agent', 8116),
    createServiceConfig('data-insights-agent', 8119),
    createServiceConfig('image-service', 8120),

    // Web app (Vite)
    {
      name: 'web',
      script: 'pnpm',
      args: ['run', 'dev'],
      cwd: './apps/web',
      env: COMMON_ENV,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 2000,
      log_date_format: 'HH:mm:ss',
    },
  ],
};
```

### Step 3: Create scripts/dev-setup.mjs

Extract pre-flight checks from dev.mjs into standalone script:

```javascript
#!/usr/bin/env node
/**
 * Development environment setup.
 * Handles emulators, env validation, and Firestore sync.
 *
 * Usage:
 *   pnpm run dev:setup    # Full setup
 *   pnpm run dev:setup -- --skip-sync  # Skip Firestore sync
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// ... (extract validateEnvVars, checkPortsAvailable, checkDockerRunning,
//      generateFirestoreConfig, syncFirestore, startEmulators, waitForEmulators
//      from dev.mjs)

async function main() {
  const args = process.argv.slice(2);
  const skipSync = args.includes('--skip-sync');

  console.log('IntexuraOS Development Setup\n');

  // Pre-flight checks
  if (!(await checkDockerRunning())) {
    console.error('Error: Docker is not running.');
    process.exit(1);
  }

  validateEnvVars();
  await checkPortsAvailable();
  await generateFirestoreConfig();

  if (!skipSync) {
    await syncFirestore();
  }

  await startEmulators();
  await waitForEmulators();

  console.log('\n✅ Setup complete! Run: pm2 start ecosystem.config.js');
}

main().catch((error) => {
  console.error('Setup failed:', error.message);
  process.exit(1);
});
```

### Step 4: Update package.json Scripts

```json
{
  "scripts": {
    "dev": "node scripts/dev-setup.mjs && pm2 start ecosystem.config.js && pm2 logs",
    "dev:setup": "node scripts/dev-setup.mjs",
    "dev:start": "pm2 start ecosystem.config.js",
    "dev:stop": "pm2 stop all",
    "dev:delete": "pm2 delete all",
    "dev:logs": "pm2 logs",
    "dev:status": "pm2 status",
    "dev:monit": "pm2 monit",
    "dev:restart": "pm2 restart all",
    "dev:emulators": "node scripts/dev-setup.mjs --skip-services",
    "emulators:start": "docker compose -f docker/docker-compose.local.yaml up -d",
    "emulators:stop": "docker compose -f docker/docker-compose.local.yaml down",
    "emulators:logs": "docker compose -f docker/docker-compose.local.yaml logs -f"
  }
}
```

### Step 5: Update Documentation

| File                                       | Required Changes                                                |
| ------------------------------------------ | --------------------------------------------------------------- |
| `README.md`                                | Update Quick Start section                                      |
| `docker/README.md`                         | Update dev commands                                             |
| `docs/setup/05-local-dev-with-gcp-deps.md` | Update Section 4 (Run Services Locally)                         |
| `docs/setup/10-claude-code-cloud-dev.md`   | Update Running Services section                                 |
| `.claude/CLAUDE.md`                        | Update Environment Variables section - replace dev.mjs patterns |
| `.claude/commands/create-service.md`       | Update Step 13 (Add to Local Dev Setup)                         |
| `.claude/reference/env-vars-patterns.md`   | Update patterns for ecosystem.config.js                         |
| `docs/designs/predev-environment.md`       | Add PM2 decision, update VM config                              |

### Step 6: Update /create-service Command

In `.claude/commands/create-service.md`, replace Step 13:

**Before:**

```markdown
### 13. Add to Local Dev Setup

Edit `scripts/dev.mjs` — add service to SERVICES array:
```

**After:**

````markdown
### 13. Add to Local Dev Setup

Edit `ecosystem.config.js` — add service to apps array:

```javascript
// In ecosystem.config.js apps array:
createServiceConfig('<service-name>', 81XX),
```
````

Choose next unused port in range 8110-\*.

````

### Step 7: Delete Deprecated Files

After migration is verified working:

```bash
rm scripts/dev.mjs
rm scripts/dev-ui.mjs
````

---

## Testing Plan

### Functional Tests

| Test           | Command                         | Expected                     |
| -------------- | ------------------------------- | ---------------------------- |
| Setup runs     | `pnpm run dev:setup`            | Emulators started, no errors |
| Services start | `pm2 start ecosystem.config.js` | All 18 services online       |
| Logs work      | `pm2 logs`                      | Aggregated colored output    |
| Status works   | `pm2 status`                    | Table with all services      |
| Monit works    | `pm2 monit`                     | TUI dashboard                |
| Crash recovery | Kill a service process          | PM2 restarts it              |
| Stop works     | `pm2 stop all`                  | All services stopped         |
| Delete works   | `pm2 delete all`                | PM2 process list cleared     |

### Smoke Tests

| Test           | Steps                               | Expected     |
| -------------- | ----------------------------------- | ------------ |
| Web app loads  | Open http://localhost:3000          | Login page   |
| API responds   | `curl http://localhost:8110/health` | 200 OK       |
| Emulators work | `curl http://localhost:8101`        | Firestore UI |

---

## Rollback Plan

If issues arise:

1. `pm2 delete all` to stop PM2
2. Revert `package.json` scripts
3. Use `node scripts/dev.mjs` directly
4. Files to restore: `scripts/dev.mjs`, `scripts/dev-ui.mjs`

---

## Migration Checklist

- [ ] Install PM2 (`pnpm add -D pm2`)
- [ ] Create `ecosystem.config.js`
- [ ] Create `scripts/dev-setup.mjs`
- [ ] Update `package.json` scripts
- [ ] Test: `pnpm run dev:setup` works
- [ ] Test: `pm2 start ecosystem.config.js` starts all services
- [ ] Test: `pm2 logs` shows aggregated logs
- [ ] Test: `pm2 monit` shows TUI
- [ ] Test: Kill a service → PM2 restarts it
- [ ] Update `README.md`
- [ ] Update `docker/README.md`
- [ ] Update `docs/setup/05-local-dev-with-gcp-deps.md`
- [ ] Update `docs/setup/10-claude-code-cloud-dev.md`
- [ ] Update `.claude/CLAUDE.md`
- [ ] Update `.claude/commands/create-service.md`
- [ ] Update `.claude/reference/env-vars-patterns.md`
- [ ] Update `docs/designs/predev-environment.md`
- [ ] Delete `scripts/dev.mjs`
- [ ] Delete `scripts/dev-ui.mjs`
- [ ] Run `pnpm run ci:tracked`
- [ ] Create PR
