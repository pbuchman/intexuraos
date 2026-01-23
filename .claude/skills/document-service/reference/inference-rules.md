# Inference Rules

How to infer answers for questions that the interactive mode asks the user.

## Overview

| Question                             | Type         | Interactive Mode  | Autonomous Mode             |
| ------------------------------------ | ------------ | ----------------- | --------------------------- |
| Q1: Why does this service exist?     | Open         | Ask user          | Infer from git + README     |
| Q2: Primary user type?               | Wizard       | Infer or ask      | Infer from routes           |
| Q3: Interaction style?               | Wizard       | Infer or ask      | Infer from routes + Pub/Sub |
| Q4: Data processing mode?            | Wizard       | Infer or ask      | Infer from HTTP methods     |
| Q5: What's the killer feature?       | Open         | Ask user          | Infer from complexity       |
| Q6: State management?                | Wizard       | Infer or ask      | Infer from Firestore        |
| Q7: Known limitations?               | Wizard       | Infer or ask      | Infer from code             |
| Q8: Planned future developments?     | Open         | Ask user          | Infer from TODOs            |

---

## Q1: Why Does This Service Exist?

### Sources (Priority Order)

1. `apps/<service-name>/README.md` — Look for "Problem" or "Purpose" section
2. First git commits — `git log --reverse --oneline apps/<service-name>/ | head -5`
3. Existing `docs/services/<service>/features.md` "The Problem" section
4. Main use case analysis — What problem does it solve?

### Inference Logic

```
IF README.md has "Problem" section:
    Use that text, condensed to 2-3 sentences
ELSE IF first commit message explains purpose:
    Use that as basis
ELSE IF features.md exists:
    Use "The Problem" section
ELSE:
    Analyze main use case and infer problem statement
```

### Output Format

2-3 sentences describing the pain point addressed.

---

## Q2: Primary User Type

### Options

- End Users — General users via web/mobile
- Developers — API consumers, external integrations
- Admins — Internal operations, management
- Internal Services — Other microservices only
- Mixed — Multiple user types

### Inference Rules

```
IF all routes are /internal/*:
    → Internal Services
ELSE IF has public routes with OAuth:
    → End Users
ELSE IF has API key auth + rate limiting:
    → Developers
ELSE IF has admin-prefixed routes:
    → Admins
ELSE:
    → ASK via wizard (interactive) or guess Mixed (autonomous)
```

---

## Q3: Interaction Style

### Options (Multi-select)

- REST API — Synchronous HTTP requests
- Async Events — Pub/Sub, message queues
- Scheduled — Cron jobs, periodic tasks
- Webhook — Receives external callbacks

### Inference Rules

```
IF has routes/*Routes.ts:
    → REST API
IF has pubsub handlers OR publishes to topics:
    → Async Events
IF has scheduled job configuration:
    → Scheduled
IF has /webhook endpoint:
    → Webhook
```

### Detection

```bash
# REST API
ls apps/<service-name>/src/routes/

# Pub/Sub
grep -r "pubsub\|PubSub" apps/<service-name>/src/

# Webhooks
grep -r "webhook" apps/<service-name>/src/routes/
```

---

## Q4: Data Processing Mode

### Options

- Read-only — Queries, lookups, no mutations
- Read-Write — Full CRUD operations
- Write-only — Ingestion, logging, event publishing
- Pipeline — Transforms and forwards data

### Inference Rules

```
IF only GET routes + read-only use cases:
    → Read-only
IF only POST/PUT + no GET:
    → Write-only
IF has GET + POST/PUT/PATCH/DELETE:
    → Read-Write
IF receives data → transforms → forwards:
    → Pipeline
```

### Detection

```bash
grep -E "\.get\(|\.post\(|\.put\(|\.patch\(|\.delete\(" apps/<service-name>/src/routes/
```

---

## Q5: Killer Feature

### Sources

1. Most complex endpoint (most lines, most logic)
2. Most detailed use case implementation
3. Unique capabilities not in other services
4. Existing documentation highlights

### Inference Logic

```
FIND endpoint with:
    - Most lines of code
    - Most dependencies
    - Most complex types

FIND use case with:
    - Most steps
    - External integrations
    - Unique business logic

COMBINE into single capability statement
```

### Output Format

One specific capability with clear value.

---

## Q6: State Management

### Options

- Stateless — No persistent state
- Firestore — Uses Firestore database
- In-Memory — Ephemeral, resets on restart
- External — Delegates to another service

### Inference Rules

```
IF has Firestore collections in migrations/registry:
    → Firestore
IF no collections AND no state:
    → Stateless
IF calls other services for state:
    → External
IF has in-memory caches only:
    → In-Memory
```

### Detection

```bash
# Firestore
grep -r "getFirestore\|collection\(" apps/<service-name>/src/
cat firestore-collections.json | jq '.[] | select(.service == "<service-name>")'

# External state
grep -r "/internal/" apps/<service-name>/src/
```

---

## Q7: Known Limitations

### Options (Multi-select)

- Rate Limits — API rate limits, quotas, throttling
- Data Size — Payload size limits, record count limits
- Feature Scope — Intentionally limited features
- None Known — No documented limitations

### Inference Rules

```
IF rate limiting in code:
    → Rate Limits
IF payload size validation:
    → Data Size
IF TODO comments about missing features:
    → Feature Scope
IF nothing found:
    → None Known
```

### Detection

```bash
# Rate limits
grep -ri "rate.?limit\|throttle\|quota" apps/<service-name>/src/

# Size limits
grep -ri "max.?size\|limit.?size\|payload.?limit" apps/<service-name>/src/
```

---

## Q8: Future Plans

### Sources (Priority Order)

1. `TODO:`, `FIXME:`, `HACK:` comments in code
2. Existing `technical-debt.md` "Future Plans" section
3. Incomplete implementations (stubs, placeholder logic)
4. GitHub issues tagged with service name

### Inference Logic

```
COLLECT all TODOs/FIXMEs from code
READ existing technical-debt.md Future Plans
IDENTIFY stub functions (empty or minimal implementation)
MERGE into prioritized list
```

### Detection

```bash
# TODOs
grep -rn "TODO:\|FIXME:\|HACK:" apps/<service-name>/src/

# Existing debt docs
cat docs/services/<service-name>/technical-debt.md 2>/dev/null

# Stubs (functions with only return statement or throw)
grep -A3 "function\|=>" apps/<service-name>/src/ | grep -B3 "throw.*NotImplemented\|return undefined"
```

### Output Format

List of planned work items, specific and actionable.

---

## Wizard Questions (Interactive Mode)

In interactive mode, if inference confidence is <100%, ask via wizard:

### Q2 Wizard

```
Who is the primary user of <service-name>?

Options:
  [End Users]         General users via web/mobile interfaces
  [Developers]        API consumers, external integrations
  [Admins]            Internal operations, management
  [Internal Services] Other microservices only (no direct users)
  [Mixed]             Multiple user types
```

### Q3 Wizard

```
How do clients interact with <service-name>? (Select all that apply)

Options:
  [REST API]       Synchronous HTTP requests
  [Async Events]   Pub/Sub, message queues, event-driven
  [Scheduled]      Cron jobs, periodic tasks, scheduled execution
  [Webhook]        Receives external callbacks/events
```

### Q4 Wizard

```
How does <service-name> handle data?

Options:
  [Read-only]   Queries, lookups, no mutations
  [Read-Write]  Full CRUD operations
  [Write-only]  Ingestion, logging, event publishing
  [Pipeline]    Transforms and forwards data
```

### Q6 Wizard

```
How does <service-name> manage state?

Options:
  [Stateless]     No persistent state
  [Firestore]     Uses Firestore database
  [In-Memory]     Ephemeral, resets on restart
  [External]      Delegates to another service
```

### Q7 Wizard

```
What are the known limitations of <service-name>? (Select all that apply)

Options:
  [Rate Limits]    API rate limits, quotas, throttling
  [Data Size]      Payload size limits, record count limits
  [Feature Scope]  Intentionally limited features
  [None Known]     No documented limitations
```
