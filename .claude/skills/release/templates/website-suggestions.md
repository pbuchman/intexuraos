# Website Suggestions Template

Use this template as a reference for auto-generating website improvements in Phase 5.

---

## Format

Auto-generate improvements from High-priority features using this format:

```markdown
### Suggestion 1: [TYPE] Title

**What:** Specific action to take
**Why:** Reason this matters for users/business
**Effort:** Low | Medium | High

### Suggestion 2: [TYPE] Title

**What:** Specific action to take
**Why:** Reason this matters for users/business
**Effort:** Low | Medium | High

### Suggestion 3: [TYPE] Title

**What:** Specific action to take
**Why:** Reason this matters for users/business
**Effort:** Low | Medium | High
```

---

## Type Prefixes

| Prefix    | Use When                                 | Example                         |
| --------- | ---------------------------------------- | ------------------------------- |
| [FEATURE] | Adding new section or component          | "Add testimonials section"      |
| [IMPROVE] | Enhancing existing functionality         | "Enhance hero section"          |
| [CONTENT] | Updating text, stats, or media           | "Update AI model count"         |
| [FIX]     | Correcting outdated or incorrect content | "Fix broken documentation link" |
| [UX]      | Improving user experience or navigation  | "Improve mobile navigation"     |

---

## Effort Levels

| Level      | Time Estimate | Characteristics                             |
| ---------- | ------------- | ------------------------------------------- |
| **Low**    | < 30 minutes  | Text update, single component, no design    |
| **Medium** | 30 min - 2 hr | Multiple components, new data, minor design |
| **High**   | > 2 hours     | New section, significant design, new assets |

---

## Selection Rules

When compiling suggestions, ensure:

1. **At least 1 is release-driven** — Directly showcases new release features
2. **At least 1 is Low effort** — Quick win for immediate value
3. **Maximum 1 is High effort** — Scope control

---

## Example Output

```markdown
Based on release v2.1.0, here are 3 website improvements:

### Suggestion 1: [CONTENT] Update RecentUpdatesSection

**What:** Add v2.1.0 release highlights: GLM-4.7-Flash support, WhatsApp reactions, Calendar preview flow
**Why:** Homepage should showcase latest capabilities to convert visitors
**Effort:** Low

### Suggestion 2: [FIX] Update hero statistics

**What:** Change "16 AI Models" to "17 AI Models", update service count badge
**Why:** Outdated stats understate platform capabilities and credibility
**Effort:** Low

### Suggestion 3: [FEATURE] Add approval flow visualization

**What:** Create animated diagram showing WhatsApp message → approval → action execution flow
**Why:** The approval workflow is a key differentiator that's currently not visualized anywhere
**Effort:** Medium
```

---

## Automatic Implementation

Phase 5 auto-implements website improvements from High-priority features without user interaction:

1. **Always update RecentUpdatesSection** with High-priority features from the release
2. **Update hero statistics** if service/model counts changed
3. **For major releases:** Create VersionHistorySection using marketing slogan from Phase 1

All improvements are implemented automatically via the `/frontend-design` skill.
