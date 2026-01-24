# PromptVault Service - Tutorial

Prompt template management.

## Prerequisites

- Auth0 access token
- (Optional) Notion integration via notion-service

## Part 1: Create Prompt

```bash
curl -X POST https://promptvault.intexuraos.com/prompt-vault/prompts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Code Review Prompt",
    "content": "Review this code for bugs, security issues, and improvements."
  }'
```

## Part 2: List Prompts

```bash
curl -X GET https://promptvault.intexuraos.com/prompt-vault/main-page \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Part 3: Update Prompt

```bash
curl -X PATCH https://promptvault.intexuraos.com/prompt-vault/prompts/prompt_id \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Updated content..."
  }'
```

## Troubleshooting

| Error     | Cause             | Solution           |
| ---------  | -----------------  | ------------------  |
| Not found | Invalid prompt_id | Check ID from list |
