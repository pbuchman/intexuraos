# Output Structure

File output locations and structure for documentation generation.

## Directory Structure

```
docs/
├── services/
│   ├── <service-name>/
│   │   ├── features.md          # Marketing-ready
│   │   ├── technical.md         # Developer reference
│   │   ├── tutorial.md          # Getting-started guide
│   │   ├── technical-debt.md    # Debt tracking
│   │   └── agent.md             # Machine-readable (autonomous only)
│   └── index.md                 # Service catalog
├── overview.md                  # Project narrative
├── documentation-runs.md        # Run history log
├── site-marketing.md            # Marketing pages source
├── site-developer.md            # Developer docs source
└── site-index.json              # Structured metadata
```

## Per-Service Files (5 total)

### features.md

**Location:** `docs/services/<service-name>/features.md`
**Purpose:** Marketing-ready documentation
**Audience:** Users, stakeholders, marketing
**Template:** [features-template.md](../templates/features-template.md)

### technical.md

**Location:** `docs/services/<service-name>/technical.md`
**Purpose:** Developer reference documentation
**Audience:** Developers, AI agents
**Template:** [technical-template.md](../templates/technical-template.md)

### tutorial.md

**Location:** `docs/services/<service-name>/tutorial.md`
**Purpose:** Getting-started guide with exercises
**Audience:** New developers
**Template:** [tutorial-template.md](../templates/tutorial-template.md)

### technical-debt.md

**Location:** `docs/services/<service-name>/technical-debt.md`
**Purpose:** Track debt items and future plans
**Audience:** Maintainers
**Template:** [technical-debt-template.md](../templates/technical-debt-template.md)

### agent.md (Autonomous Mode Only)

**Location:** `docs/services/<service-name>/agent.md`
**Purpose:** Machine-readable interface specification
**Audience:** AI agents
**Template:** [agent-template.md](../templates/agent-template.md)

---

## Aggregated Files

### services/index.md

**Location:** `docs/services/index.md`
**Purpose:** Service catalog listing all services
**Update Rule:** Incremental — add documented services, remove from pending

**Sections:**
- Documented Services (with links)
- Pending Documentation (checklist)

### overview.md

**Location:** `docs/overview.md`
**Purpose:** Project narrative and architecture overview
**Update Rule:** Update when service adds new capability category

**Sections:**
- What is IntexuraOS
- How It Works (by problem category)
- Services table
- Getting Started
- Architecture

### documentation-runs.md

**Location:** `docs/documentation-runs.md`
**Purpose:** Log of all documentation runs
**Update Rule:** Append only — never modify existing entries

**Entry Format:**
```markdown
## YYYY-MM-DD — <service-name>

**Action:** [Created | Updated]
**Agent:** [document-service | service-scribe]
**Files:** [list]
**Coverage:** N%
**Debt Found:** [counts]
```

---

## Website Source Files

### site-marketing.md

**Location:** `docs/site-marketing.md`
**Purpose:** Source for marketing pages
**Update Rule:** Incremental — add service capabilities, use cases, roadmap items

**Sections:**
- Hero Section
- Value Propositions
- Capabilities (by category: Capture, Organize, Automate, Integrate)
- Use Cases
- Feature Comparison
- Roadmap

### site-developer.md

**Location:** `docs/site-developer.md`
**Purpose:** Source for developer documentation
**Update Rule:** Incremental — add APIs, events, models, config

**Sections:**
- Quick Start
- API Reference (by service)
- Events Reference (Pub/Sub)
- Data Models
- Configuration
- Guides

### site-index.json

**Location:** `docs/site-index.json`
**Purpose:** Structured metadata for site build
**Update Rule:** Append service to array, update stats

**Schema:**
```json
{
  "lastUpdated": "YYYY-MM-DD",
  "services": [
    {
      "id": "service-name",
      "name": "Service Display Name",
      "tagline": "One line description",
      "features": "Key features list",
      "status": "documented | pending",
      "lastUpdated": "YYYY-MM-DD",
      "docs": {
        "features": "services/service-name/features.md",
        "technical": "services/service-name/technical.md",
        "debt": "services/service-name/technical-debt.md"
      }
    }
  ],
  "capabilities": [
    {
      "id": "capture",
      "name": "Capture",
      "services": ["whatsapp-service", "webhooks-service"],
      "description": "Turn inputs into organized data"
    }
  ],
  "stats": {
    "totalServices": 14,
    "documentedServices": 3,
    "completion": "21%"
  }
}
```

---

## Incremental Update Rules

### Adding a New Service

1. Create service directory: `docs/services/<service-name>/`
2. Generate 4-5 files in service directory
3. Update `services/index.md`:
   - Add to "Documented Services" section
   - Remove from "Pending Documentation" section
4. Update `site-marketing.md`:
   - Add capabilities to appropriate category
   - Add use cases
   - Add future plans to roadmap
5. Update `site-developer.md`:
   - Add API endpoints to reference
   - Add events to Pub/Sub reference
   - Add models to Data Models section
   - Add config to Configuration section
6. Update `site-index.json`:
   - Append service object to `services` array
   - Update `stats.documentedServices` and `stats.completion`
7. Update `overview.md` if service adds new capability category
8. Append entry to `documentation-runs.md`

### Updating Existing Service

1. Regenerate service files (preserve user insights)
2. Update `documentation-runs.md` with new entry
3. If debt items resolved, move to "Resolved Issues"
4. If new capabilities, update website files

---

## File Linking Conventions

### Within Service Docs

```markdown
See [Technical Reference](technical.md) for API details.
See [Features](features.md) for capabilities.
```

### To Other Services

```markdown
Works with [WhatsApp Service](../whatsapp-service/features.md)
```

### To Project Docs

```markdown
Part of [IntexuraOS](../../overview.md)
Run log: [documentation-runs.md](../../documentation-runs.md)
```
