# Create Linear Issue from Sentry

**Trigger:** User calls `/sentry linear <sentry-url>`

Creates a Linear issue from a Sentry error with proper cross-linking.

## Input

- Sentry URL (e.g., `https://intexuraos-dev-pbuchman.sentry.io/issues/123/`)

## Steps

### 1. Parse Sentry URL

Extract:
- Organization slug
- Issue ID

### 2. Fetch Sentry Issue Details

```
Call: mcp__sentry__get_issue_details
Parameters:
  - issueUrl: <full-sentry-url>

Extract:
  - title (error message)
  - firstSeen
  - count (event count)
  - userCount
  - stacktrace (first 3 relevant frames)
  - release
  - environment
```

### 3. Search for Existing Linear Issue

```
Call: mcp__linear__list_issues
Parameters:
  - query: "[sentry]"
  - team: "pbuchman"
```

Search the results for:
- Title containing the Sentry error message (fuzzy match)
- Description containing the Sentry URL

If match found:
- Display: "Existing Linear issue found: [INT-XXX](url)"
- Ask: "Use existing issue or create new?"
- If using existing, skip to step 5

### 4. Create Linear Issue

```
Call: mcp__linear__create_issue
Parameters:
  - title: "[sentry] <short-error-message>"
  - team: "pbuchman"
  - state: "Backlog"
  - labels: ["bug", "sentry"]
  - description: |
      ## Sentry Error

      **Sentry Issue:** [<issue-id>](<sentry-url>)
      **First Seen:** <first-seen>
      **Events:** <count>
      **Users Affected:** <user-count>

      ## Stack Trace

      ```
      <top 3 relevant stack frames>
      ```

      ## Environment

      - **Release:** <release>
      - **Environment:** <environment>

      ## Investigation Notes

      <!-- Add findings here -->
```

### 5. Update Sentry Issue

Note: Sentry MCP doesn't support adding comments. Document the link manually or via Sentry UI.

Log the cross-reference:
```
Created Linear issue INT-XXX for Sentry issue <sentry-id>
Cross-link: <linear-url> ↔ <sentry-url>
```

### 6. Output

Display:

```
## Linear Issue Created

**Linear:** [INT-XXX](linear-url) - [sentry] <title>
**Sentry:** [<issue-id>](sentry-url)

### Next Steps
1. Run `/linear INT-XXX` to start working on this issue
2. Or continue with `/sentry analyze <sentry-url>` for AI analysis
```

## Naming Convention (NON-NEGOTIABLE)

All Linear issues created from Sentry MUST use the `[sentry]` prefix:

| Example                                            |
| -------------------------------------------------- |
| `[sentry] TypeError: null is not an object`        |
| `[sentry] ReferenceError: x is not defined`        |
| `[sentry] Network request failed in AuthService`   |
| `[sentry] Cannot read property 'id' of undefined`  |

This allows:
- Easy identification of Sentry-sourced issues
- Searchability in Linear
- Consistent naming across the codebase
