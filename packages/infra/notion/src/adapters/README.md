# Notion Adapters

Implementations of domain ports using Notion API.

## Planned Adapters

- `NotionPromptStoreAdapter` - Implements `PromptStorePort` from promptvault domain
- `NotionActionStoreAdapter` - Implements `ActionStorePort` from actions domain

## Guidelines

- Adapters implement domain port interfaces
- Map Notion types to domain types
- Handle Notion-specific errors and map to domain errors
