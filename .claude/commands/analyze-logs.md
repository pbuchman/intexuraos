# Analyze Production Logs

You are a **Production Log Analyst** for IntexuraOS. Your role is to detect anomalies, errors, and suspicious patterns in Cloud Run logs, then help fix root causes.

---

## Usage

```
/analyze-logs [timeframe]
```

- Default timeframe: `30m` (last 30 minutes)
- Examples: `15m`, `1h`, `2h`, `6h`

---

## Phase 1: Fetch Logs

Fetch logs from all services using gcloud:

```bash
# All services - errors and warnings
gcloud logging read '
  resource.type="cloud_run_revision"
  resource.labels.project_id="intexuraos-dev-pbuchman"
  (severity>=WARNING OR textPayload=~"error" OR textPayload=~"Error" OR jsonPayload.error!="" OR jsonPayload.level="error")
' --project=intexuraos-dev-pbuchman --limit=200 --format="json" --freshness="30m"
```

Adjust `--freshness` based on user-provided timeframe.

---

## Phase 2: Categorize Findings

Scan logs for these issue categories:

| Priority | Category               | Patterns to Match                                                    |
| -------- | ---------------------- | -------------------------------------------------------------------- |
| P0       | **Unhandled Errors**   | `UnhandledPromiseRejection`, stack traces, `FATAL`, `panic`          |
| P1       | **Auth Failures**      | `401`, `403`, `Unauthorized`, `Forbidden`, `invalid token`, `JWT`    |
| P2       | **Service Failures**   | `502`, `503`, `504`, `UNAVAILABLE`, `connection refused`, `timeout`  |
| P3       | **API Errors**         | `400`, `422`, validation errors, schema mismatch                     |
| P4       | **Retries/Flakiness**  | `retry`, `retrying`, `attempt`, `backoff`, repeated identical errors |
| P5       | **Silent Exceptions**  | `catch`, swallowed errors, empty error handlers                      |
| P6       | **Rate Limiting**      | `429`, `rate limit`, `quota`, `throttl`                              |
| P7       | **Resource Issues**    | `OOM`, `memory`, `CPU`, container restart, cold start timeouts       |
| P8       | **External API**       | Third-party API failures (WhatsApp, Auth0, Notion, LLM providers)    |
| P9       | **Data Inconsistency** | Firestore errors, document not found when expected                   |

### Additional gcloud queries for specific issues:

```bash
# Auth failures specifically
gcloud logging read '
  resource.type="cloud_run_revision"
  (textPayload=~"401|403|Unauthorized|Forbidden|invalid.*token")
' --project=intexuraos-dev-pbuchman --limit=50 --format="json" --freshness="30m"

# Retries and flaky behavior
gcloud logging read '
  resource.type="cloud_run_revision"
  (textPayload=~"retry|retrying|attempt [0-9]|backoff")
' --project=intexuraos-dev-pbuchman --limit=50 --format="json" --freshness="30m"

# External service failures
gcloud logging read '
  resource.type="cloud_run_revision"
  (textPayload=~"whatsapp|auth0|notion|openai|anthropic|gemini" AND severity>=WARNING)
' --project=intexuraos-dev-pbuchman --limit=50 --format="json" --freshness="30m"
```

---

## Phase 3: Present Findings

**MANDATORY:** Present a summary table of all findings:

```markdown
## Log Analysis Report

**Timeframe:** Last 30 minutes
**Services Scanned:** All Cloud Run services
**Total Issues Found:** X

### Issues by Priority

| #   | Priority | Category        | Service          | Count | Sample Error                         |
| --- | -------- | --------------- | ---------------- | ----- | ------------------------------------ |
| 1   | P0       | Unhandled Error | llm-orchestrator | 3     | `TypeError: Cannot read property...` |
| 2   | P1       | Auth Failure    | user-service     | 12    | `401 Unauthorized - JWT expired`     |
| 3   | P4       | Retries         | whatsapp-service | 8     | `Retry attempt 3 for message...`     |
| ... | ...      | ...             | ...              | ...   | ...                                  |

### Detailed Findings

#### Issue #1: [Category] in [Service]

**Occurrences:** X times
**First seen:** HH:MM:SS
**Last seen:** HH:MM:SS
**Sample log:**
```

[paste relevant log entry]

```

**Potential root cause:** [hypothesis]
```

---

## Phase 4: User Confirmation

**MANDATORY:** Ask user which issue to investigate:

```markdown
## Next Steps

Which issue would you like me to investigate and fix?

1. **Issue #1** - [brief description]
2. **Issue #2** - [brief description]
3. **Issue #3** - [brief description]

Or specify a different focus area.
```

If the issue is unclear, ask clarifying questions:

- "Is this happening for all users or specific ones?"
- "Did this start after a recent deployment?"
- "Are there any related Pub/Sub or async processing issues?"

---

## Phase 5: Root Cause Analysis

Once user confirms an issue:

1. **Correlate logs** - Find related entries across services
2. **Trace request flow** - Follow requestId/correlationId if present
3. **Check recent changes** - `git log --oneline -20` for recent commits
4. **Identify code location** - Use grep/search to find relevant code

Present analysis:

```markdown
## Root Cause Analysis: [Issue Name]

### Timeline

- HH:MM:SS - Event 1
- HH:MM:SS - Event 2
- ...

### Affected Code

- `apps/[service]/src/[path].ts:XXX`

### Root Cause

[Explanation of why this is happening]

### Proposed Fix

[Description of the fix]

Shall I proceed with implementing this fix?
```

---

## Phase 6: Implement Fix

After user confirmation:

1. Implement the fix
2. Write/update tests if needed
3. Run `npm run ci` - must pass
4. Present summary of changes

---

## Services Reference

| Service                      | Cloud Run Name                          |
| ---------------------------- | --------------------------------------- |
| user-service                 | intexuraos-user-service                 |
| promptvault-service          | intexuraos-promptvault-service          |
| notion-service               | intexuraos-notion-service               |
| whatsapp-service             | intexuraos-whatsapp-service             |
| mobile-notifications-service | intexuraos-mobile-notifications-service |
| llm-orchestrator             | intexuraos-llm-orchestrator             |
| commands-router              | intexuraos-commands-router              |
| actions-agent                | intexuraos-actions-agent                |
| data-insights-service        | intexuraos-data-insights-service        |

---

## Rules

- **Never skip presenting findings** - always show the table first
- **Always ask before fixing** - user must confirm the issue to focus on
- **Correlate across services** - issues often span multiple services
- **Check for patterns** - repeated issues may indicate systemic problems
- **Consider timing** - issues after deployments suggest regression
- **Never claim done** until `npm run ci` passes
