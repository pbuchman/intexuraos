# Website Audit Workflow

Analyze the website for improvement opportunities based on the current release.

---

## Overview

This workflow produces EXACTLY 3 suggestions by combining:

1. **Release-Driven Analysis**: Map new features to website sections
2. **Full Audit Analysis**: Review HomePage.tsx for staleness/improvements

---

## Step 1: Release-Driven Analysis

### 1.1 Map Features to Website Sections

For each new feature in the release, identify which website sections could showcase it:

| Website Section      | What It Showcases                |
| -------------------- | -------------------------------- |
| Hero Section         | Main value proposition           |
| RecentUpdatesSection | Latest features and improvements |
| CapabilitiesSection  | Core capabilities grid           |
| IntegrationsSection  | External service connections     |
| TechnicalSection     | Architecture and tech stack      |
| TestimonialsSection  | User feedback and case studies   |

### 1.2 Identify Direct Mappings

| Release Feature          | Website Impact                              |
| ------------------------ | ------------------------------------------- |
| New AI model integration | Update CapabilitiesSection, hero stats      |
| New service added        | Update IntegrationsSection, service count   |
| Performance improvement  | Update TechnicalSection, add benchmark      |
| New user-facing feature  | Add to RecentUpdatesSection                 |
| Breaking change          | Update migration notice, documentation link |

---

## Step 2: Full Audit Analysis

### 2.1 Read Current Homepage

```bash
cat apps/web/src/pages/HomePage.tsx
```

### 2.2 Check for Staleness

Review each section for:

| Check                | Staleness Indicator                      |
| -------------------- | ---------------------------------------- |
| Stats/numbers        | Out of date (model count, service count) |
| Feature descriptions | Don't reflect current capabilities       |
| Recent updates       | Older than 2 releases                    |
| Screenshots          | Don't match current UI                   |
| Links                | Point to outdated docs or missing pages  |

### 2.3 Identify Improvement Opportunities

| Opportunity Type | Examples                                  |
| ---------------- | ----------------------------------------- |
| Content refresh  | Update stats, feature descriptions        |
| Visual update    | New screenshots, updated diagrams         |
| New section      | Add testimonials, case studies            |
| UX improvement   | Better CTA placement, clearer value prop  |
| SEO enhancement  | Better meta descriptions, structured data |

---

## Step 3: Prioritize Suggestions

### 3.1 Scoring Criteria

Rate each potential suggestion on:

| Criterion     | Weight | Description                      |
| ------------- | ------ | -------------------------------- |
| Release Tie   | 40%    | Directly related to this release |
| Impact        | 30%    | Visible improvement to users     |
| Effort        | 20%    | Implementation complexity        |
| Staleness Fix | 10%    | Addresses outdated content       |

### 3.2 Effort Estimation

| Effort Level | Characteristics                               |
| ------------ | --------------------------------------------- |
| **Low**      | Text update, single component, < 30 mins      |
| **Medium**   | Multiple components, new data, 30 mins - 2 hr |
| **High**     | New section, design work, > 2 hours           |

---

## Step 4: Compile Final 3 Suggestions

### 4.1 Selection Rules

1. **At least 1 must be release-driven** (directly showcases new features)
2. **At least 1 must be Low effort** (quick win)
3. **No more than 1 High effort** (scope control)

### 4.2 Output Format

Use template from [`templates/website-suggestions.md`](../templates/website-suggestions.md):

```markdown
### Suggestion 1: [FEATURE] Update RecentUpdatesSection

**What:** Add v{X.Y.Z} release highlights with {feature1}, {feature2}
**Why:** Website should showcase latest capabilities to visitors
**Effort:** Low

### Suggestion 2: [IMPROVE] Enhance hero statistics

**What:** Update model count (17→18), service count (18→19)
**Why:** Stats are outdated by 2 releases, understates current scale
**Effort:** Low

### Suggestion 3: [CONTENT] Add integration showcase

**What:** Create visual grid of supported integrations (WhatsApp, Notion, Linear, etc.)
**Why:** Integration breadth is a key differentiator not currently highlighted
**Effort:** Medium
```

---

## Type Prefixes

| Prefix    | Meaning                            |
| --------- | ---------------------------------- |
| [FEATURE] | Add new feature/section to website |
| [IMPROVE] | Enhance existing section           |
| [CONTENT] | Update text, stats, or media       |
| [FIX]     | Correct staleness or errors        |
| [UX]      | User experience improvement        |

---

## Example Analysis

### Release: v2.1.0

**New features:**

- GLM-4.7-Flash model support
- WhatsApp approval reactions
- Calendar preview flow

**Website audit findings:**

- Hero stats: "16 AI Models" (now 17)
- RecentUpdatesSection: Shows v2.0.0 content
- No visual showing approval flow

**Final 3 suggestions:**

1. **[CONTENT] Update RecentUpdatesSection** (Release-driven, Low effort)
2. **[FIX] Update hero AI model count** (Staleness fix, Low effort)
3. **[FEATURE] Add approval flow diagram** (Release-driven, Medium effort)
