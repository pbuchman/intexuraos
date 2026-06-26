# Task 1 Report: Private Media Model And Storage Paths

## Scope

Implemented only the Task 1 changes for private WhatsApp media model/storage support:

- extended the private media domain model
- exported the new media storage status type
- extended `MediaStoragePort` with private upload methods
- implemented private GCS path uploads in the adapter
- updated `FakeMediaStorage`
- added the required storage adapter regression test

Did not implement later tasks such as routes, Matrix upload behavior, or UI.

## Files Changed

- `apps/whatsapp-service/src/domain/whatsapp/models/PrivateWhatsApp.ts`
- `apps/whatsapp-service/src/domain/whatsapp/index.ts`
- `apps/whatsapp-service/src/domain/whatsapp/ports/mediaStorage.ts`
- `apps/whatsapp-service/src/infra/gcs/mediaStorageAdapter.ts`
- `apps/whatsapp-service/src/__tests__/fakes.ts`
- `apps/whatsapp-service/src/__tests__/infra/mediaStorageAdapter.test.ts`

## RED Evidence

### 1. Brief command result

Command from the task brief:

```bash
pnpm --filter @intexuraos/whatsapp-service exec vitest run src/__tests__/infra/mediaStorageAdapter.test.ts --runInBand
```

Result:

- failed immediately because the repo currently uses Vitest `4.0.17`, whose CLI rejects `--runInBand`
- error: `CACError: Unknown option --runInBand`

### 2. Focused failing test run with current CLI

Command run to capture the actual behavioral failure:

```bash
pnpm --filter @intexuraos/whatsapp-service exec vitest run src/__tests__/infra/mediaStorageAdapter.test.ts
```

Result:

- file failed as expected
- failing test: `stores private WhatsApp media under the private prefix`
- failure: `TypeError: adapter.uploadPrivateMedia is not a function`

This confirmed the missing private upload API before implementation.

## GREEN Evidence

### Focused verification

```bash
pnpm --filter @intexuraos/whatsapp-service exec vitest run src/__tests__/infra/mediaStorageAdapter.test.ts
```

Result:

- passed
- `14 passed`

```bash
pnpm --filter @intexuraos/whatsapp-service typecheck
```

Result:

- passed

### Full commit gate verification

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-task1.txt
```

Result:

- passed completely
- key evidence:
  - `[test:coverage] ✓ 4876 tests passed`
  - `✅ CI passed`

## What Changed

### Domain model

- added `PrivateWhatsAppMediaStorageStatus = 'stored'`
- extended `PrivateWhatsAppMediaInfo` with:
  - `storageStatus`
  - `gcsPath`
  - `thumbnailGcsPath`
  - `storedMimeType`
  - `storedSizeBytes`
  - `storedAt`

### Domain exports

- exported `PrivateWhatsAppMediaStorageStatus` from the WhatsApp domain index

### Media storage port

- added:
  - `uploadPrivateMedia(...)`
  - `uploadPrivateThumbnail(...)`

### GCS adapter

- added private path builders for:
  - `whatsapp/private/{userId}/{messageId}/{mediaId}.{ext}`
  - `whatsapp/private/{userId}/{messageId}/{mediaId}_thumb.{ext}`
- extracted shared save behavior into `saveObject(...)`
- refactored existing public upload methods to use `saveObject(...)`
- implemented the two new private upload methods using the private prefix

### Test fake

- added matching private upload methods to `FakeMediaStorage`
- preserved the existing upload failure toggles for the new methods

### Tests

- added the required adapter test asserting the private GCS prefix and thumbnail suffix

## Self-Review

- scope stayed within the task-owned files listed in the brief
- later private-media tasks were not implemented
- existing public upload behavior was preserved while removing duplication through `saveObject(...)`
- fake behavior matches the new adapter path format
- focused test, typecheck, and full tracked CI all passed

## Concerns

- the task brief's exact Vitest command is stale for the repo's current Vitest version because `--runInBand` is no longer supported; I captured that failure and then used the current equivalent command for RED/GREEN verification
