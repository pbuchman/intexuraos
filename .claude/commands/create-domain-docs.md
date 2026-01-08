# Create Domain Documentation

Generate domain-focused documentation by analyzing a service's domain layer.

**Vision:** Deep dive into one service's domain, producing comprehensive documentation of models, ports, use cases, and events.

---

## Usage

```
/create-domain-docs [service-name]
```

If no service is specified, list available services and ask which to document.

---

## Available Services with Domain Layers

| Service                        | Domain Subdirectories           |
| ------------------------------ | ------------------------------- |
| `actions-agent`                | models, ports, usecases         |
| `calendar-agent`               | models, ports, useCases         |
| `commands-router`              | events, models, ports, usecases |
| `data-insights-service`        | dataSource                      |
| `llm-orchestrator`             | research                        |
| `mobile-notifications-service` | filters, notifications          |
| `notion-service`               | integration                     |
| `promptvault-service`          | promptvault                     |
| `user-service`                 | identity, settings, oauth       |
| `whatsapp-service`             | whatsapp                        |

**Services without domain layer:** `api-docs-hub`, `web`

---

## Output Structure

```
docs/current/
├── domains.md                    # Master index of all domain docs
└── domain/
    ├── actions-agent.md
    ├── commands-router.md
    ├── llm-orchestrator.md
    └── ...
```

---

## Analysis Steps

### Step 1: Explore Domain Structure

Launch Explore agent:

```
Analyze the domain layer of {service-name}. Find and document:

1. **Models** - All domain entities, value objects, enums
   - What data they hold
   - Relationships between them
   - Status/state enumerations

2. **Ports** - All interface definitions
   - Repository ports (data access)
   - External service ports
   - What operations each port defines

3. **Use Cases** - All business operations
   - Input/output types
   - Dependencies (which ports they use)
   - Fire-and-forget vs result-returning
   - Error handling patterns

4. **Events** - Pub/Sub event types (if any)
   - Event names and payloads
   - Who publishes, who subscribes

5. **Utils** - Shared utilities within domain
   - What they do
   - Who uses them

Search in: apps/{service-name}/src/domain/
```

### Step 2: Map Dependencies

```
For the {service-name} domain, trace:

1. Which infrastructure adapters implement each port
2. How use cases are wired via services.ts
3. Which routes invoke which use cases
4. Pub/Sub flows (publish → subscribe chain)

Search in: apps/{service-name}/src/infra/, apps/{service-name}/src/services.ts, apps/{service-name}/src/routes/
```

### Step 3: Identify Improvements

During analysis, note any domain issues:

- Naming inconsistencies (mixed conventions, unclear names)
- Code duplication (repeated types, duplicated utilities)
- Missing abstractions (inline logic that should be extracted)
- Dead code (unused models, ports, or use cases)
- Architecture violations (domain importing from infra)

### Step 4: Generate Documentation

Write to `docs/current/domain/{service-name}.md` using the template below.

### Step 5: Update Master Index

Update `docs/current/domains.md` to include or update the entry for this service.

### Step 6: Output Improvement Suggestions

After generating documentation, output suggestions **to chat** (NOT in the docs file):

```
## Domain Improvement Suggestions for {service-name}

### High Priority
- [Issue]: description — `path/to/file.ts`

### Medium Priority
- [Issue]: description — `path/to/file.ts`

### Low Priority
- [Issue]: description — `path/to/file.ts`

### Recommended Actions
1. [First action to take]
2. [Second action to take]
```

**IMPORTANT:** Improvement suggestions are output to chat only. Documentation files contain only factual descriptions of the current state.

---

## Documentation Template

Write the following structure to `docs/current/domain/{service-name}.md`:

```markdown
# {Service Name} Domain

## Overview

[2-3 sentences describing what this domain handles]

## Domain Structure
```

apps/{service-name}/src/domain/
├── {subdomain}/
│ ├── models/
│ ├── ports/
│ ├── usecases/
│ ├── events/ (if present)
│ └── utils/ (if present)
└── index.ts

```

## Models

### {ModelName}

| Field       | Type     | Description          |
| ----------- | -------- | -------------------- |
| `fieldName` | `string` | What this field is   |

**File:** `domain/{subdomain}/models/{file}.ts`

**Status Values:** (if applicable)
| Status    | Meaning                  |
| --------- | ------------------------ |
| `pending` | Waiting to be processed  |

[Repeat for each model]

## Ports

### {PortName}

**Purpose:** What this port abstracts

**File:** `domain/{subdomain}/ports/{file}.ts`

| Method             | Returns              | Description        |
| ------------------ | -------------------- | ------------------ |
| `methodName(args)` | `Promise<Result<T>>` | What it does       |

**Implemented by:** `infra/{adapter}.ts`

[Repeat for each port]

## Use Cases

### {UseCaseName}

**Purpose:** What business operation this performs

**File:** `domain/{subdomain}/usecases/{file}.ts`

**Pattern:** Sync / Fire-and-forget / Background

| Aspect           | Value                       |
| ---------------- | --------------------------- |
| **Input**        | `{InputType}`               |
| **Output**       | `Result<{OutputType}, Error>` |
| **Dependencies** | Port1, Port2                |
| **Invoked by**   | Route / Pub/Sub / Scheduler |

**Flow:**
1. Step one
2. Step two
3. ...

[Repeat for each use case]

## Events (if applicable)

### {EventType}

| Field      | Type     | Description     |
| ---------- | -------- | --------------- |
| `field`    | `string` | What it means   |

**Published by:** `{use case or infra}`
**Subscribed by:** `{service}` via `{endpoint}`

[Repeat for each event]

## Utilities (if applicable)

| Utility                 | Purpose                      | File                  |
| ----------------------- | ---------------------------- | --------------------- |
| `functionName()`        | What it does                 | `utils/{file}.ts`     |

## Dependency Graph

```

Routes
└── Use Cases
├── Repository Ports → Firestore Adapters
├── External Ports → API Clients
└── Publisher Ports → Pub/Sub

```

## Key Patterns

- [Pattern 1]: How it's used in this domain
- [Pattern 2]: ...
```

---

## Master Index Template

Create or update `docs/current/domains.md`:

```markdown
# Domain Documentation

Documentation for domain layers across all services.

## Services

| Service                      | Domain Focus           | Doc Link                                       |
| ---------------------------- | ---------------------- | ---------------------------------------------- |
| actions-agent                | Action execution       | [View](domain/actions-agent.md)                |
| commands-router              | Command routing        | [View](domain/commands-router.md)              |
| data-insights-service        | Data analysis          | [View](domain/data-insights-service.md)        |
| llm-orchestrator             | LLM research           | [View](domain/llm-orchestrator.md)             |
| mobile-notifications-service | Push notifications     | [View](domain/mobile-notifications-service.md) |
| notion-service               | Notion integration     | [View](domain/notion-service.md)               |
| promptvault-service          | Prompt management      | [View](domain/promptvault-service.md)          |
| user-service                 | User identity/settings | [View](domain/user-service.md)                 |
| whatsapp-service             | WhatsApp messaging     | [View](domain/whatsapp-service.md)             |

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
```

---

## Implementation Notes

- Use Explore agents for thorough analysis
- Include file paths and line numbers for traceability
- Focus on domain layer only (not infra implementation details)
- Keep descriptions concise but complete
- Keep headers minimal (no "auto-generated" notices)
- Update domains.md every time a service is documented

### Dual Output Pattern

| Output                  | Destination                        | Content                           |
| ----------------------- | ---------------------------------- | --------------------------------- |
| Documentation           | `docs/current/domain/{service}.md` | Factual current state             |
| Improvement Suggestions | Chat (user-facing)                 | Issues found, recommended actions |

**Why separate?** Documentation should be stable and factual. Improvement suggestions are actionable feedback that may become outdated once addressed.
