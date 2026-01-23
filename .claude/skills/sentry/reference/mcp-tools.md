# Sentry MCP Tools Reference

Quick reference for all available Sentry MCP tools.

## Organization & Project Discovery

### `mcp__sentry__whoami`

Get authenticated user information.

```
Parameters: none
Returns: user name, email, organizations
```

### `mcp__sentry__find_organizations`

List accessible organizations.

```
Parameters:
  - query: (optional) Filter by name/slug

Returns: organization list with slugs and regionUrl
```

### `mcp__sentry__find_teams`

List teams in an organization.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - query: (optional) Filter by name/slug

Returns: team list with slugs
```

### `mcp__sentry__find_projects`

List projects in an organization.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - query: (optional) Filter by name/slug

Returns: project list with slugs and platforms
```

### `mcp__sentry__find_releases`

List releases in an organization.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - projectSlug: (optional) Filter by project
  - query: (optional) Filter by version

Returns: release list with versions and dates
```

## Issue Operations

### `mcp__sentry__get_issue_details`

Get full issue details including stacktrace.

```
Parameters:
  - issueUrl: "https://...sentry.io/issues/123/"
  OR
  - organizationSlug: "intexuraos-dev-pbuchman"
  - issueId: "INTEXURAOS-DEVELOPMENT-42"

Returns: title, stacktrace, frequency, affected users, metadata
```

### `mcp__sentry__get_issue_tag_values`

Get tag value distribution for impact analysis.

```
Parameters:
  - issueUrl: "https://...sentry.io/issues/123/"
  - tagKey: "url" | "browser" | "environment" | "release"

Returns: distribution of tag values with counts
```

Common tag keys:
- `url` - Request URLs affected
- `browser` - Browser types and versions
- `browser.name` - Browser names only
- `os` - Operating systems
- `environment` - Deployment environments
- `release` - Software releases
- `device` - Device types
- `user` - Affected users

### `mcp__sentry__list_issues`

Query issues with Sentry syntax.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - query: "is:unresolved is:unassigned"
  - sort: "date" | "freq" | "new" | "user"
  - limit: 10-100
  - projectSlugOrId: (optional)

Returns: list of issues matching query
```

Common queries:
- `is:unresolved` - Open issues only
- `is:unassigned` - Unassigned issues
- `level:error` - Error level only
- `firstSeen:-24h` - New in last 24 hours
- `lastSeen:-1h` - Active in last hour

### `mcp__sentry__list_issue_events`

Get events within a specific issue.

```
Parameters:
  - issueUrl: "https://...sentry.io/issues/123/"
  - query: "environment:production"
  - statsPeriod: "14d"
  - limit: 50

Returns: list of events within the issue
```

### `mcp__sentry__update_issue`

Update issue status or assignment.

```
Parameters:
  - issueUrl: "https://...sentry.io/issues/123/"
  - status: "resolved" | "unresolved" | "ignored"
  - assignedTo: "user:123456" | "team:789"

Returns: updated issue
```

## Trace & Event Operations

### `mcp__sentry__get_trace_details`

Get trace overview.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - traceId: "a4d1aae7216b47ff8117cf4e09ce9d0a"

Returns: trace statistics, span breakdown, Sentry link
```

### `mcp__sentry__get_event_attachment`

Download or list event attachments.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - projectSlug: "intexuraox-development"
  - eventId: "c49541c747cb4d8aa3efb70ca5aba243"
  - attachmentId: (optional) specific attachment

Returns: attachment list or download
```

### `mcp__sentry__list_events`

Search events across datasets.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - dataset: "errors" | "logs" | "spans"
  - query: "level:error"
  - fields: ["issue", "count()"]
  - statsPeriod: "14d"
  - limit: 10

Returns: events matching query
```

## AI Analysis

### `mcp__sentry__analyze_issue_with_seer`

AI-powered root cause analysis.

```
Parameters:
  - issueUrl: "https://...sentry.io/issues/123/"
  OR
  - organizationSlug: "intexuraos-dev-pbuchman"
  - issueId: "INTEXURAOS-DEVELOPMENT-42"
  - instruction: (optional) custom analysis instruction

Returns: root cause analysis, code fixes, implementation steps
```

**Note:** Analysis may take 2-5 minutes if not cached.

## Documentation

### `mcp__sentry__search_docs`

Search Sentry documentation.

```
Parameters:
  - query: "Django setup configuration"
  - guide: "python/django" (optional)
  - maxResults: 3

Returns: documentation snippets
```

### `mcp__sentry__get_doc`

Fetch full documentation page.

```
Parameters:
  - path: "/platforms/javascript/guides/nextjs.md"

Returns: full markdown content
```

## Admin Operations

### `mcp__sentry__create_team`

Create a new team.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - name: "backend-team"

Returns: created team
```

### `mcp__sentry__create_project`

Create a new project (includes DSN).

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - teamSlug: "pbuchman"
  - name: "my-new-service"
  - platform: "javascript" | "python" | etc.

Returns: created project with DSN
```

### `mcp__sentry__update_project`

Update project settings.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - projectSlug: "my-project"
  - name: (optional) new name
  - platform: (optional) new platform
  - teamSlug: (optional) reassign to team

Returns: updated project
```

### `mcp__sentry__create_dsn`

Create additional DSN for existing project.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - projectSlug: "my-project"
  - name: "Production"

Returns: new DSN
```

### `mcp__sentry__find_dsns`

List DSNs for a project.

```
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - projectSlug: "my-project"

Returns: list of DSNs
```
