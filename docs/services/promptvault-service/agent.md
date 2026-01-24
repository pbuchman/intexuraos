# promptvault-service — Agent Interface

> Machine-readable interface definition for AI agents interacting with promptvault-service.

---

## Identity

| Field    | Value                                                           |
| --------  | ---------------------------------------------------------------  |
| **Name** | promptvault-service                                             |
| **Role** | Prompt Management Service                                       |
| **Goal** | Store, organize, and retrieve AI prompts via Notion integration |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface PromptVaultServiceTools {
  // Get main PromptVault page
  getMainPage(): Promise<MainPageResult>;

  // List all prompts
  listPrompts(): Promise<PromptsListResult>;

  // Create new prompt
  createPrompt(params: { title: string; prompt: string }): Promise<PromptResult>;

  // Get single prompt
  getPrompt(promptId: string): Promise<PromptResult>;

  // Update prompt
  updatePrompt(
    promptId: string,
    params: {
      title?: string;
      prompt?: string;
    }
  ): Promise<PromptResult>;
}
```

### Types

```typescript
interface MainPageResult {
  page: {
    id: string;
    title: string;
    url: string;
  };
  preview: {
    blocks: NotionBlock[];
  };
}

interface Prompt {
  id: string;
  title: string;
  prompt: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface PromptsListResult {
  prompts: Prompt[];
}

interface PromptResult {
  prompt: Prompt;
}

interface NotionBlock {
  type: string;
  content: string;
}
```

---

## Constraints

| Rule                   | Description                                        |
| ----------------------  | --------------------------------------------------  |
| **Notion Connected**   | Requires notion-service integration configured     |
| **Page ID Configured** | PromptVault Notion page ID must be set in settings |
| **Ownership**          | Users can only access their own prompts            |

---

## Usage Patterns

### List All Prompts

```typescript
const result = await listPrompts();
// result.prompts contains array of user's prompts
```

### Create New Prompt

```typescript
const result = await createPrompt({
  title: 'Code Review Assistant',
  prompt: 'You are a code review assistant...',
});
// result.prompt.url links to Notion page
```

### Get Prompt for Use

```typescript
const result = await getPrompt(promptId);
// result.prompt.prompt contains the full prompt text
```

### Update Existing Prompt

```typescript
const result = await updatePrompt(promptId, {
  prompt: 'Updated prompt text...',
});
```

---

## Prerequisites

Before using PromptVault:

1. **Connect Notion** - Call `POST /notion/connect` with integration token
2. **Configure Page** - Set PromptVault page ID in user settings
3. **Share Page** - Share Notion page with the integration

---

## Data Flow

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ promptvault- │────▶│ notion-service   │────▶│ Notion API      │
│ service      │     │ (get token)      │     │ (CRUD pages)    │
└──────────────┘     └──────────────────┘     └─────────────────┘
```

---

## Error Handling

| Error Code         | Description                             |
| ------------------  | ---------------------------------------  |
| `MISCONFIGURED`    | Notion not connected or page ID not set |
| `NOT_FOUND`        | Prompt not found or not accessible      |
| `DOWNSTREAM_ERROR` | Notion API communication failed         |

---

**Last updated:** 2026-01-19
