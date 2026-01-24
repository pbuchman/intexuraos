# Seer AI Analysis Workflow

**Trigger:** User calls `/sentry analyze <sentry-url>`

Uses Sentry's AI-powered analysis (Seer) to get root cause analysis with specific code fixes.

## What Seer Provides

Seer is Sentry's AI analysis feature that provides:

- **Root cause analysis** with code-level explanations
- **Specific file locations** and line numbers where errors occur
- **Concrete code fixes** you can apply
- **Step-by-step implementation guidance**

## Input

- Sentry URL (e.g., `https://intexuraos-dev-pbuchman.sentry.io/issues/123/`)
- OR Sentry issue ID with organization

## Steps

### 1. Parse Input

Extract from URL:

- Organization slug (or use default: `intexuraos-dev-pbuchman`)
- Issue ID

### 2. Fetch Basic Issue Details First

```
Call: mcp__sentry__get_issue_details
Parameters:
  - issueUrl: <full-sentry-url>

Purpose: Get context for the issue before Seer analysis
```

### 3. Run Seer Analysis

```
Call: mcp__sentry__analyze_issue_with_seer
Parameters:
  - issueUrl: <full-sentry-url>
  OR
  - organizationSlug: "intexuraos-dev-pbuchman"
  - issueId: <issue-id>
```

**Note:** Analysis may take 2-5 minutes if not cached. Results are cached for subsequent calls.

### 4. Display Analysis Results

Output format:

````markdown
## Seer Analysis: <issue-title>

**Sentry Issue:** [<issue-id>](sentry-url)

### Root Cause

<Seer's root cause analysis - what's actually happening>

### Affected Code

**File:** `<file-path>`
**Line:** <line-number>

```<language>
<code snippet from Seer>
```
````

### Recommended Fix

```<language>
<Seer's recommended code fix>
```

### Implementation Steps

1. <step 1 from Seer>
2. <step 2 from Seer>
3. <step 3 from Seer>

### Additional Context

<any additional context Seer provides>
```

### 5. Offer Next Steps

Ask user:

```
Would you like to:
1. Create a Linear issue for this fix
2. Create a branch and implement the fix now
3. Just save this analysis for later
```

**Option 1:** Run [create-linear-issue.md](create-linear-issue.md) workflow

**Option 2:**

```bash
git fetch origin
git checkout -b fix/sentry-<short-id> origin/development
```

Then implement Seer's recommended fix.

**Option 3:** Output complete and done.

## When to Use Seer vs Manual Investigation

| Use Seer                       | Use Manual Investigation              |
| ------------------------------ | ------------------------------------- |
| Clear error with stack trace   | Data corruption issues                |
| TypeErrors, ReferenceErrors    | Intermittent failures                 |
| API response handling errors   | Race conditions                       |
| Validation failures            | Issues requiring Firestore inspection |
| Third-party integration errors | Complex business logic bugs           |

## Seer Limitations

- Analysis is based on stack trace and error context only
- Cannot access your codebase directly (provides general guidance)
- May not understand domain-specific business logic
- Results should be validated against actual code

**Always verify Seer's suggestions against the actual codebase before implementing.**
