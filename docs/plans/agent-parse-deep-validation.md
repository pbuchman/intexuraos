# Agent Instructions: Parse Deep Validation Report

## Your Task
Parse a single Deep Validation Report comment and return structured JSON.

## Input
You receive a JSON object:
```json
{
  "pr_number": 1180,
  "created_at": "2026-03-14T00:11:49Z",
  "body": "### Deep Validation Report...",
  "prDetails": {
    "title": "[INT-842] Fix...",
    "headRefName": "task_xxx",
    "url": "https://github.com/...",
    "additions": 1,
    "deletions": 1,
    "changedFiles": 1
  },
  "taskDetails": {
    "workerType": "opus"
  }
}
```

PR details and task details (including workerType/model) are provided — you do NOT need to fetch anything.

## Output
Return ONLY valid JSON (no markdown, no commentary):

```json
{
  "taskId": "uuid or null",
  "linearIssueId": "INT-XXX",
  "prNumber": 1180,
  "prUrl": "https://github.com/pbuchman/intexuraos/pull/1180",
  "title": "PR title",
  "branchName": "task_xxx or feature/int-xxx",
  "linesChanged": 2,
  "filesChanged": 1,
  "complexityScore": 1,
  "workerType": "opus",
  "deepValidation": {
    "costUsd": 0.013837,
    "overallOutcome": "Implemented",
    "overallSeverity": "pass",
    "claimsVerified": 9,
    "claimsContradicted": 0,
    "executingPlansInvoked": false,
    "requestingCodeReviewInvoked": true,
    "codeReviewerDispatched": true,
    "orderCorrect": false,
    "anomaliesCritical": 0,
    "anomaliesWarning": 2,
    "anomaliesMinor": 1,
    "anomalyTypes": ["...", "..."],
    "anomalySeverityUnavailable": false
  }
}
```

## Parsing Rules

### Identifiers (from prDetails and taskDetails)
- `taskId`: If `headRefName` matches `task_<uuid>`, extract the UUID. Otherwise `null`.
- `linearIssueId`: Find `[INT-XXX]` or `INT-XXX:` in `title`, extract `INT-XXX`.
- `linesChanged`: `additions + deletions`
- `filesChanged`: `changedFiles`
- `complexityScore`: linesChanged <20→1, <100→2, <300→3, <500→4, else 5
- `workerType`: Extract from `taskDetails.workerType` if present. Otherwise `null`.

### Report Body Parsing

#### Cost
Find `**Cost:** $X.XXXXXX` → extract number. Not found → `null`.

#### Overall Section
Find `#### Overall` then table. Two formats exist:

**Three-column format** (`| Key | Result | Severity |`):
- `overallOutcome`: "Outcome" row, "Result" column value
- `overallSeverity`: Emoji in Severity column: 🟢→"pass", 🟠→"warning", 🔴→"critical"

**Two-column format** (`| Key Info | Value |`):
- `overallOutcome`: "Outcome" row, "Value" column
- `overallSeverity`: Look for emoji in the Value column. If no emoji found, default to `"pass"`

#### Claim Verification Section
Find `#### Claim Verification` then table:
- `claimsVerified`: Count rows with "Verified" or "✅" in Result column
- `claimsContradicted`: Count rows with "Contradicted" or "❌" in Result column
- `executingPlansInvoked`: Find row with `superpowers_executing_plans` or `superpowers:executing-plans`. If claim value is "used" → true, "not used" → false.
- `requestingCodeReviewInvoked`: Same for `superpowers_requesting_code_review` or `superpowers:requesting-code-review`.

#### Contract Verification Section
Find `#### Contract Verification` then table:
- `codeReviewerDispatched`: Row about `code-reviewer subagent` has "Compliant" or "fulfilled" → true
- `orderCorrect`: `true` if and only if BOTH of the following rows have Result = "Compliant" (or "fulfilled"):
  1. Row matching `executing-plans invoked first` (or `superpowers:executing-plans`)
  2. Row matching `requesting-code-review invoked second` (or `superpowers:requesting-code-review`)
  If either row is missing or has any other Result value (e.g. "Not compliant"), set `orderCorrect` to `false`.

#### Anomalies Section
Find `#### Anomalies` then table. Multiple column layouts exist:

**With Severity column** (e.g. `| Anomaly | Transcript Reference | Severity |`):
- `anomaliesCritical`: Count 🔴 in Severity column
- `anomaliesWarning`: Count 🟠 in Severity column
- `anomaliesMinor`: Count 🟡 in Severity column

**Without Severity column** (e.g. `| Anomaly Type | Description |` or `| Message ID | Anomaly Type | Description |`):
- `anomaliesCritical`: 0
- `anomaliesWarning`: 0
- `anomaliesMinor`: 0
- Note: Set a flag `"anomalySeverityUnavailable": true` in the output to indicate severity data could not be extracted

**For all formats:**
- `anomalyTypes`: Array of unique values from the column containing the anomaly description (first column if `Anomaly`, or the `Anomaly Type` column). These may be full natural-language sentences, not short tokens.

## Edge Cases
- No Cost line → `costUsd: null`
- No Anomalies section → counts = 0, `anomalyTypes: []`, `anomalySeverityUnavailable: false`
- Anomalies section with no Severity column → counts = 0, `anomalySeverityUnavailable: true`, still extract `anomalyTypes`
- Overall section with 2-column format → extract from Value column, default severity to `"pass"` if no emoji
- Missing Contract Verification rows for skill order → `orderCorrect: false`
- Missing section → use sensible defaults

## DO NOT
- Do NOT fetch any external data
- Do NOT use bash commands
- Do NOT output anything except the JSON
- Do NOT wrap in markdown code blocks