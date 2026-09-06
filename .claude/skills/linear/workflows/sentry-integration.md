# SentryBox Integration Workflow

**Trigger:** `/linear` receives a private SentryBox issue URL.

This workflow creates one Linear issue from SentryBox evidence. It never queries
Legacy Sentry SaaS or a second error provider.

## Steps

1. Require an HTTPS URL whose host is exactly the configured `ERROR_HUB_HOST`
   and whose path matches `/organizations/intexuraos/issues/<id>/`.
2. Verify the `error_hub` and Linear MCP servers are available. Do not fall back
   to a server named `sentry` or to a REST token.
3. Call the `error_hub` server's `execute_sentry_tool` tool with
   `name`: `get_issue_details` and
   `arguments`: `{ issueUrl: <exact issue URL> }`.
   Extract the title, project, environment, release, occurrence count,
   timestamps, and stack evidence returned by SentryBox.
4. Search Linear for an existing issue with the same SentryBox issue URL or
   title. If a match exists, report it instead of creating a duplicate.
5. Create one unassigned Linear issue in team `IntexuraOS`, state `Backlog`,
   titled `[sentry] <short error title>`.
6. Include the private SentryBox URL, environment, project, release, occurrence
   count, error summary, and relevant stack excerpt in the description. Never
   copy credentials or an entire downloaded event payload.
7. Stop after creation unless the user explicitly requested implementation.

## Required output

```text
FETCH: Read SentryBox issue <id> through error_hub
CREATED: INT-XXX "[sentry] <error>"
STATE: Backlog
ROUTING: Creation complete
```

## Description template

```markdown
## SentryBox Error

**Issue:** [<issue-id>](private-sentrybox-url)

- **Project:** <project>
- **Environment:** <environment>
- **Release:** <release-or-unknown>
- **Occurrences:** <count>

### Error summary

<concise summary>

### Relevant stack

<small relevant excerpt>

## Test Requirements (MANDATORY - implement first)

<specific regression tests derived from the failure>
```

The `[sentry]` prefix and existing `sentry_*` task result fields remain protocol
names; they do not indicate a Legacy Sentry dependency.
