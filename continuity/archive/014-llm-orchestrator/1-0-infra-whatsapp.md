# Task 1-0: Create infra-whatsapp Package

**Tier:** 1 (Independent deliverable)

---

## Context Snapshot

- LLM Orchestrator will send WhatsApp notifications when research completes
- WhatsApp sending logic currently exists in `apps/whatsapp-service/src/infra/whatsapp/sender.ts`
- Need a shared package to avoid code duplication
- Follows pattern of existing `packages/infra-*` packages

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

WhatsApp message sending functionality is tightly coupled to whatsapp-service. LLM Orchestrator needs to send completion notifications via WhatsApp but cannot import from another app (ESLint boundary rule).

---

## Scope

**In scope:**

- Create `packages/infra-whatsapp/` package structure
- Implement `WhatsAppSender` interface with `sendTextMessage`
- Export types and factory function via index.ts
- Add to root tsconfig.json references
- Add to eslint.config.js boundaries

**Non-scope:**

- Webhook handling (stays in whatsapp-service)
- Media sending (text only for notifications)
- Batch message sending

---

## Required Approach

### Step 1: Create package structure

```bash
mkdir -p packages/infra-whatsapp/src
```

### Step 2: Create package.json

```json
{
  "name": "@intexuraos/infra-whatsapp",
  "version": "0.0.4",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc --build",
    "clean": "rm -rf dist .tsbuildinfo"
  },
  "dependencies": {
    "@intexuraos/common-core": "*"
  }
}
```

### Step 3: Create tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../common-core" }]
}
```

### Step 4: Create src/types.ts

```typescript
export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
}

export interface SendMessageParams {
  to: string;
  message: string;
}

export interface WhatsAppError {
  code: 'API_ERROR' | 'NETWORK_ERROR' | 'INVALID_CONFIG';
  message: string;
  statusCode?: number;
}
```

### Step 5: Create src/sender.ts

```typescript
import { ok, err, type Result } from '@intexuraos/common-core';
import type { WhatsAppConfig, SendMessageParams, WhatsAppError } from './types.js';

export interface WhatsAppSender {
  sendTextMessage(params: SendMessageParams): Promise<Result<void, WhatsAppError>>;
}

export function createWhatsAppSender(config: WhatsAppConfig): WhatsAppSender {
  return {
    async sendTextMessage(params: SendMessageParams): Promise<Result<void, WhatsAppError>> {
      const url = `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: params.to,
          type: 'text',
          text: { body: params.message },
        }),
      });

      if (!response.ok) {
        return err({
          code: 'API_ERROR',
          message: `WhatsApp API error: ${response.status}`,
          statusCode: response.status,
        });
      }

      return ok(undefined);
    },
  };
}
```

### Step 6: Create src/index.ts

```typescript
export { createWhatsAppSender, type WhatsAppSender } from './sender.js';
export type { WhatsAppConfig, SendMessageParams, WhatsAppError } from './types.js';
```

### Step 7: Update root tsconfig.json

Add reference:

```json
{ "path": "packages/infra-whatsapp" }
```

### Step 8: Update eslint.config.js

Add to `boundaries/elements`:

```javascript
{ type: 'infra-whatsapp', pattern: ['packages/infra-whatsapp/src/**'], mode: 'folder' }
```

Add to boundaries rules - `infra-whatsapp` can only import `common-core`.

---

## Step Checklist

- [ ] Create `packages/infra-whatsapp/` directory structure
- [ ] Create `package.json` with correct dependencies
- [ ] Create `tsconfig.json` extending base
- [ ] Create `src/types.ts` with interfaces
- [ ] Create `src/sender.ts` with implementation
- [ ] Create `src/index.ts` with exports
- [ ] Add to root `tsconfig.json` references
- [ ] Add to `eslint.config.js` boundaries
- [ ] Run `npm install` to update lockfile
- [ ] Run verification commands

---

## Definition of Done

1. Package exists at `packages/infra-whatsapp/`
2. `WhatsAppSender` interface and factory function exported
3. TypeScript compiles without errors
4. ESLint passes with boundaries configured
5. Package can be imported by apps

---

## Verification Commands

```bash
npm run typecheck
npm run lint
npm run build
```

---

## Rollback Plan

If verification fails:

1. Remove `packages/infra-whatsapp/` directory
2. Revert changes to `tsconfig.json`
3. Revert changes to `eslint.config.js`
4. Run `npm install` to update lockfile
