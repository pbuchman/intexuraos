# PromptVault Service

Prompt template management with Notion database sync.

## The Problem

Managing prompt templates:

1. **Storage** - Save and organize prompts
2. **Versioning** - Update prompts over time
3. **Notion sync** - Bidirectional sync with Notion databases
4. **Retrieval** - Find prompts by name or tags

## How It Helps

PromptVault-service provides:

1. **CRUD** - Create, read, update, delete prompts
2. **Notion integration** - Sync with Notion databases via notion-service
3. **Search** - Find prompts by criteria
4. **Main page** - List all prompts

## Key Features

**Prompt Model:**

- Title and content
- Notion page ID
- Created/updated timestamps

**Operations:**

- `GET /prompt-vault/main-page` - List prompts
- `GET /prompt-vault/prompts` - List prompts
- `POST /prompt-vault/prompts` - Create prompt
- `GET /prompt-vault/prompts/:id` - Get specific prompt
- `PATCH /prompt-vault/prompts/:id` - Update prompt

## Use Cases

### Create prompt

1. User submits title and content
2. Prompt saved to Firestore
3. Optional: Sync to Notion database

### List prompts

1. GET `/prompt-vault/main-page`
2. Returns all user's prompts

### Update prompt

1. PATCH `/prompt-vault/prompts/:id` with new content
2. Updates Firestore and Notion

## Key Benefits

**Centralized storage** - All prompts in one place

**Notion sync** - Edit in Notion or app

**Version tracking** - Created/updated timestamps

**Integration** - notion-service handles connection

## Limitations

**Notion required** - Sync requires Notion integration

**No tags** - No tagging system currently

**No sharing** - Prompts are private to user

**No duplication** - Can't copy prompts
