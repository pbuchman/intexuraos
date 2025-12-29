# Task 1-0: Create infra-whatsapp Package

## Objective

Create a shared WhatsApp sender package extracted from whatsapp-service patterns.

## Structure

```
packages/infra-whatsapp/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── sender.ts
    └── types.ts
```

## Interface

```typescript
// types.ts
export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
}

export interface SendMessageParams {
  to: string; // Phone number with country code
  message: string; // Text message content
}

// sender.ts
export interface WhatsAppSender {
  sendTextMessage(params: SendMessageParams): Promise<Result<void, WhatsAppError>>;
}

export function createWhatsAppSender(config: WhatsAppConfig): WhatsAppSender;
```

## Dependencies

- `@intexuraos/common-core` (Result types)

## Reference

Look at `apps/whatsapp-service/src/infra/whatsapp/` for existing patterns.

## Verification

```bash
npm run typecheck
npm run lint
```

## Acceptance Criteria

- [ ] Package created with correct structure
- [ ] WhatsAppSender interface defined
- [ ] Implementation using Meta API
- [ ] Exports via index.ts
- [ ] `npm run typecheck` passes
