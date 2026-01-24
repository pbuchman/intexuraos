# PromptVault Service - Technical Reference

## Overview

PromptVault-service manages prompt templates stored in Firestore with optional Notion database synchronization.

## API Endpoints

| Method | Path                               | Description         | Auth         |
| ------ | ---------------------------------- | ------------------- | ------------ |
| GET    | `/prompt-vault/main-page`          | List all prompts    | Bearer token |
| GET    | `/prompt-vault/prompts`            | List prompts        | Bearer token |
| POST   | `/prompt-vault/prompts`            | Create prompt       | Bearer token |
| GET    | `/prompt-vault/prompts/:prompt_id` | Get specific prompt | Bearer token |
| PATCH  | `/prompt-vault/prompts/:prompt_id` | Update prompt       | Bearer token |

## Domain Models

### Prompt

| Field | Type | Description |
| -------------- | --------- | ------------------------------------------ | |
| `id` | string | Unique identifier (Notion page ID or UUID) |
| `userId` | string | Owner user ID |
| `title` | string | Prompt title |
| `content` | string | Prompt content |
| `notionPageId` | string \ | undefined | Linked Notion page |
| `createdAt` | string | ISO 8601 creation time |
| `updatedAt` | string | ISO 8601 last update |

## Dependencies

**Internal Services:**

- `notion-service` - Notion API operations

**Infrastructure:**

- Firestore (`prompts` collection) - Prompt storage
- Firestore (`prompt_vault_settings` collection) - User Notion settings

## Configuration

| Environment Variable             | Required | Description                     |
| -------------------------------- | -------- | ------------------------------- |
| `INTEXURAOS_NOTION_SERVICE_URL`  | Yes      | notion-service base URL         |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Yes      | Shared secret for internal auth |

## Gotchas

**Notion dependency** - Sync features require connected Notion integration via notion-service.

**ID format** - For Notion-synced prompts, `id` is the Notion page ID. For local prompts, it's a UUID.

**Update behavior** - PATCH updates only provided fields. Notion-synced prompts also update in Notion.

**Main page alias** - `/main-page` is an alias for listing all prompts.

## File Structure

```
apps/promptvault-service/src/
  domain/promptvault/
    models/
      Prompt.ts
    ports/
      PromptRepository.ts
      PromptVaultSettingsPort.ts
    usecases/
      ListPromptsUseCase.ts
      GetPromptUseCase.ts
      CreatePromptUseCase.ts
      UpdatePromptUseCase.ts
  infra/
    firestore/
      promptVaultSettingsRepository.ts
    notion/
      notionServiceClient.ts
      promptApi.ts
  routes/
    promptRoutes.ts
  services.ts
  server.ts
```
