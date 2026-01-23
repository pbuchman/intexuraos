# Linear Issue Template for Sentry Errors

Use this template when creating Linear issues from Sentry errors.

## Template

```markdown
## Sentry Error

**Sentry Issue:** [{{sentry_issue_id}}]({{sentry_url}})
**First Seen:** {{first_seen}}
**Events:** {{event_count}}
**Users Affected:** {{user_count}}

## Stack Trace

```
{{stacktrace_excerpt}}
```

## Environment

- **Release:** {{release}}
- **Environment:** {{environment}}
- **Browser:** {{top_browser}} (if applicable)

## Investigation Notes

<!-- Add findings here during investigation -->
```

## Field Descriptions

| Field               | Source                              | Example                          |
| ------------------- | ----------------------------------- | -------------------------------- |
| `sentry_issue_id`   | Issue ID from Sentry                | `INTEXURAOS-DEVELOPMENT-42`      |
| `sentry_url`        | Full Sentry issue URL               | `https://...sentry.io/issues/42` |
| `first_seen`        | `firstSeen` from issue details      | `2026-01-15T10:30:00Z`           |
| `event_count`       | `count` from issue details          | `127`                            |
| `user_count`        | `userCount` from issue details      | `23`                             |
| `stacktrace_excerpt`| Top 3-5 relevant stack frames       | (see example below)              |
| `release`           | Release version from context        | `1.2.3`                          |
| `environment`       | Environment tag                     | `production`                     |
| `top_browser`       | Most affected browser from tags     | `Chrome 120`                     |

## Stack Trace Excerpt Guidelines

Include only the relevant frames:

```
✅ Good - Relevant frames only:
at TodoService.findById (apps/todos-agent/src/domain/todos/service.ts:45:12)
at processRequest (apps/todos-agent/src/routes/routes.ts:128:24)
at handleWebhook (apps/whatsapp-service/src/routes/webhookRoutes.ts:67:8)

❌ Bad - Too much noise:
at Object.runMicrotasks (node:internal/process/task_queues:130:5)
at processTicksAndRejections (node:internal/process/task_queues:95:21)
at async Module.executeJob (/app/node_modules/fastify/lib/...
```

## Title Convention

Always use `[sentry]` prefix:

```
[sentry] TypeError: Cannot read property 'id' of undefined
[sentry] Network request failed in AuthService
[sentry] Validation error: email format invalid
```
