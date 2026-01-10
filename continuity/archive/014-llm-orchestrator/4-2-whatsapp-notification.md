# Task 4-2: Implement WhatsApp Notification Sender

**Tier:** 4 (Depends on infra-whatsapp package from Tier 1)

---

## Context Snapshot

- infra-whatsapp package exists (Tier 1)
- NotificationSender port defined (Tier 3)
- Need to send WhatsApp message when research completes
- Need user's WhatsApp phone number from user-service

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Implement NotificationSender port that:

1. Checks if user has WhatsApp connected
2. Sends completion notification via WhatsApp
3. Handles failure gracefully (best effort)

---

## Scope

**In scope:**

- Create WhatsAppNotificationSender class
- Get user's phone number from internal user-service API
- Format notification message
- Handle errors gracefully (don't fail research on notification failure)

**Non-scope:**

- infra-whatsapp package (done in Tier 1)
- User phone number storage (handled by user-service)

---

## Required Approach

### Step 1: Create notification directory

```bash
mkdir -p apps/research-agent-service/src/infra/notification
```

### Step 2: Create infra/notification/WhatsAppNotificationSender.ts

```typescript
import { createWhatsAppSender, type WhatsAppSender } from '@intexuraos/infra-whatsapp';
import { ok, err, isErr, type Result } from '@intexuraos/common-core';
import type { NotificationSender, NotificationError } from '../../domain/research/index.js';

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
}

export interface UserPhoneLookup {
  getPhoneNumber(userId: string): Promise<string | null>;
}

export class WhatsAppNotificationSender implements NotificationSender {
  private readonly sender: WhatsAppSender;
  private readonly userPhoneLookup: UserPhoneLookup;

  constructor(config: WhatsAppConfig, userPhoneLookup: UserPhoneLookup) {
    this.sender = createWhatsAppSender(config);
    this.userPhoneLookup = userPhoneLookup;
  }

  async sendResearchComplete(
    userId: string,
    researchId: string,
    title: string
  ): Promise<Result<void, NotificationError>> {
    const phone = await this.userPhoneLookup.getPhoneNumber(userId);

    if (phone === null) {
      return err({
        code: 'USER_NOT_CONNECTED',
        message: 'User has no WhatsApp phone number configured',
      });
    }

    const message = this.formatMessage(title, researchId);
    const result = await this.sender.sendTextMessage({
      to: phone,
      message,
    });

    if (isErr(result)) {
      return err({
        code: 'SEND_FAILED',
        message: result.error.message,
      });
    }

    return ok(undefined);
  }

  private formatMessage(title: string, researchId: string): string {
    const displayTitle = title || 'Untitled Research';
    return `🔬 Research Complete!\n\n"${displayTitle}"\n\nView results in your dashboard.`;
  }
}
```

### Step 3: Create infra/notification/NoopNotificationSender.ts

For testing and when WhatsApp is not configured:

```typescript
import { ok, type Result } from '@intexuraos/common-core';
import type { NotificationSender, NotificationError } from '../../domain/research/index.js';

export class NoopNotificationSender implements NotificationSender {
  async sendResearchComplete(
    _userId: string,
    _researchId: string,
    _title: string
  ): Promise<Result<void, NotificationError>> {
    // Silently succeed - notifications are optional
    return ok(undefined);
  }
}
```

### Step 4: Create infra/notification/index.ts

```typescript
export {
  WhatsAppNotificationSender,
  type WhatsAppConfig,
  type UserPhoneLookup,
} from './WhatsAppNotificationSender.js';
export { NoopNotificationSender } from './NoopNotificationSender.js';
```

### Step 5: Update infra/index.ts

```typescript
export * from './research/index.js';
export * from './llm/index.js';
export * from './notification/index.js';
```

---

## Step Checklist

- [ ] Create infra/notification directory
- [ ] Implement `WhatsAppNotificationSender`
- [ ] Implement `NoopNotificationSender` for fallback
- [ ] Create index files
- [ ] Update infra/index.ts
- [ ] Run verification commands

---

## Definition of Done

1. WhatsAppNotificationSender implements NotificationSender
2. User phone lookup integrated
3. Message formatted correctly
4. Errors handled gracefully
5. NoopNotificationSender available for testing
6. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Remove infra/notification directory
2. Revert changes to infra/index.ts
