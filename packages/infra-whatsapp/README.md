# @intexuraos/infra-whatsapp

WhatsApp Business Cloud API client (messages, media, delivery receipts).

## Contract

- **Layer:** infra-wrapper
- **Dependencies:** `@intexuraos/common-core`
- **Exports:** `./src/index.ts` (source-exports — no `dist/` emission)

## Usage

```ts
import { WhatsAppClient } from '@intexuraos/infra-whatsapp';
```

For full API documentation, see [`docs/packages/infra-whatsapp/README.md`](../../docs/packages/infra-whatsapp/README.md).

## Tests

```bash
pnpm vitest run packages/infra-whatsapp
```
