# Domain Documentation

Documentation for domain layers across all services.

## Services

| Service                      | Domain Focus           | Doc                                |
| ---------------------------- | ---------------------- | ---------------------------------- |
| actions-agent                | Action execution       | Not documented                     |
| commands-router              | Command routing        | Not documented                     |
| data-insights-service        | Data analysis          | Not documented                     |
| llm-orchestrator             | LLM research           | Not documented                     |
| mobile-notifications-service | Push notifications     | Not documented                     |
| notion-service               | Notion integration     | Not documented                     |
| promptvault-service          | Prompt management      | Not documented                     |
| user-service                 | User identity/settings | Not documented                     |
| whatsapp-service             | WhatsApp messaging     | [View](domain/whatsapp-service.md) |

## Quick Reference

### Common Patterns

| Pattern         | Description                               | Example Service  |
| --------------- | ----------------------------------------- | ---------------- |
| Result<T, E>    | Error handling without exceptions         | All              |
| Fire-and-forget | Async operations after HTTP response      | whatsapp-service |
| Port/Adapter    | Hexagonal architecture for external deps  | All              |
| Use Case class  | Single-responsibility business operations | All              |

### Status Vocabularies

| Domain        | Statuses                               |
| ------------- | -------------------------------------- |
| Webhook       | pending, processing, completed, failed |
| Transcription | pending, processing, completed, failed |
| Link Preview  | pending, completed, failed             |

---

_Use `/create-domain-docs [service-name]` to generate documentation for a specific service._
