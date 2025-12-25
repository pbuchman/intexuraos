# Notion Prompt Vault — ChatGPT Custom Model

A custom ChatGPT model (GPT) for reviewing, improving, and storing prompts in Notion via IntexuraOS APIs.

## Overview

This model enables users to:

- **Review prompts** using a 10-dimension weighted scoring system
- **Improve prompts** through iterative feedback loops
- **Save prompts** directly to a Notion database via OAuth-authenticated API

## Screenshots

### Model Configuration

![ChatGPT Model Configuration](./chatgpt-model-configuration.png)

### Actions (API Integration)

![ChatGPT Model Actions](./chatgpt-model-actions.png)

## Commands

| Command            | Description                             |
| ------------------ | --------------------------------------- |
| `/review <prompt>` | Evaluate prompt (10 dimensions)         |
| `/save <prompt>`   | Direct save to Notion (bypasses review) |
| `/save`            | Save last-reviewed prompt               |
| `/md <prompt>`     | Review + save in one step               |
| `/config notion`   | Configure Notion connection             |
| `/help`            | Show available commands                 |

## Review Dimensions

Prompts are scored on 10 weighted dimensions:

| Dimension             | Weight |
| --------------------- | ------ |
| Goal clarity          | 10     |
| Output format         | 9      |
| Constraints & rules   | 9      |
| Role                  | 8      |
| Context               | 7      |
| Edge cases            | 7      |
| Quality bar           | 6      |
| Step-by-step guidance | 5      |
| Examples              | 4      |
| Tone                  | 3      |

Score ≥ 8.0 allows saving. Below that, the model suggests improvements.

## Integration

Uses IntexuraOS services:

- **auth-service** — OAuth authentication via Auth0
- **promptvault-service** — Notion API integration for prompt storage

## Files

- `instructions.txt` — Model behavior instructions
- `context.txt` — Test cases, scoring reference, state management
