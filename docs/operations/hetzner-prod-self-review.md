# Hetzner Production Self-Review

Linear: INT-1637

Parent issue: INT-1632

Final integration review for the Hetzner migration replacement PR.

| name | type | disposition | owner subtask | verification evidence |
| --- | --- | --- | --- | --- |
| user-service | app service | migrated | INT-1634 | PM2 port 8110 and nginx `/api/user` route |
| notion-service | app service | migrated | INT-1634 | PM2 port 8112 and nginx `/api/notion` route |
| whatsapp-service | app service | migrated | INT-1634, INT-1635 | PM2 port 8113, `/api/whatsapp`, and `/internal/whatsapp/*` routes |
| mobile-notifications-service | app service | migrated | INT-1634, INT-1635 | PM2 port 8114 and Scheduler route `/internal/notifications/digest/run-yesterday` |
| research-agent | app service | migrated | INT-1634, INT-1635 | PM2 port 8116 and `/internal/llm/*` routes |
| commands-agent | app service | migrated | INT-1634, INT-1635 | PM2 port 8117 and `/internal/commands` route |
| actions-agent | app service | migrated | INT-1634, INT-1635 | PM2 port 8118 and `/internal/actions/*` routes |
| fishing-assistant-service | app service | migrated | INT-1634 | PM2 port 8119 and nginx `/api/fishing-assistant` route |
| image-service | app service | migrated | INT-1634, INT-1636 | PM2 port 8120 and nginx `/api/images` route |
| notes-agent | app service | migrated | INT-1634 | PM2 port 8121 and nginx `/api/notes` route |
| app-settings-service | app service | migrated | INT-1634 | PM2 port 8122 and nginx `/api/settings` route |
| bookmarks-agent | app service | migrated | INT-1634, INT-1635 | PM2 port 8124 and `/internal/bookmarks/*` routes |
| calendar-agent | app service | migrated | INT-1634, INT-1635 | PM2 port 8125 and `/internal/calendar/generate-preview` route |
| linear-agent | app service | migrated | INT-1634, INT-1635 | PM2 port 8126 and linear Scheduler routes |
| web-agent | app service | migrated | INT-1634 | PM2 port 8127 and nginx `/api/web` route |
| code-agent | app service | migrated | INT-1634, INT-1635 | PM2 port 8128, `/api/code`, PR triage, drain queue, and execution-memory routes |
| hellscript-agent | app service | migrated | INT-1634 | PM2 port 8131 and nginx `/api/hellscript-agent` route |
| llm-usage-service | app service | migrated | INT-1634 | PM2 port 8132 and nginx `/api/llm-usage` route |
| api-docs-hub | app service | migrated | INT-1634 | PM2 port 8133; api-docs-hub remains local-only on Hetzner and is not exposed through the web service manifest |
| web frontend | static web | migrated | INT-1636, INT-1637 | `scripts/hetzner/deploy-web.sh` writes sanitized Vite env and publishes `apps/web/dist` |
| workers/transcription | Cloud Function | retained | INT-1633, INT-1635 | `terraform/hetzner-prod/functions.tf` references retained function and audio-stored topic |
| workers/vm-lifecycle | Cloud Function | retained | INT-1633, INT-1635 | VM start/stop function URIs remain in retained GCP root |
| workers/orchestrator | external worker | retained | INT-1632 | Not moved by this migration; code-agent URLs remain available |
| docker/code-worker | Artifact Registry image | retained | INT-1633 | Artifact Registry and Cloud Build remain in GCP |
| Firestore | database | retained | INT-1633 | Retained inventory records `(default)` database |
| Pub/Sub topics | messaging | retained | INT-1633, INT-1635 | Topics remain in retained GCP; Hetzner root adds staged push subscriptions |
| Cloud Scheduler jobs | scheduler | retained | INT-1635 | Existing GCP jobs remain; Hetzner root adds staged HTTP jobs |
| Secret Manager | secrets | retained | INT-1633, INT-1634 | VM secret loader reads explicit runtime allowlist from GCP Secret Manager |
| GCS buckets | storage | retained | INT-1633, INT-1636 | `/share/*` and `/images/*` proxy retained public buckets |
| Cloud Functions | retained compute | retained | INT-1633, INT-1635 | Transcription and VM lifecycle functions remain on GCP |
| Artifact Registry | container registry | retained | INT-1633 | Images remain available for rollback and retained workers |
| Cloud Build | build system | retained | INT-1633, INT-1636 | Existing build triggers remain available |
| monitoring | observability | retained | INT-1633 | Existing GCP monitoring module is not removed |
| Cloud Run app services | rollback compute | retained | INT-1637 | Not destroyed in this PR; available until explicit post-cutover cleanup |
| data-insights-agent | stale service assumption | removed | INT-1632 | Replaced by current `fishing-assistant-service` scope |
| stale PR #1747 assumptions | stale implementation | removed | INT-1632, INT-1637 | Not used as the implementation branch |

## Review Checklist

- Terraform foundation: INT-1633 resources use `terraform/hetzner-prod` and do
  not create a second GCP environment root.
- Runtime and edge: INT-1634 PM2 ports, nginx routes, secrets, certbot, and
  Google OIDC verification match the current service inventory.
- Async control plane: INT-1635 retains GCP topics/functions and stages
  Hetzner-targeted Pub/Sub and Scheduler consumers behind
  `activate_hetzner_async_consumers`.
- Web and integrations: INT-1636 keeps public API paths generated from
  `apps/web/service-manifest.json`, retains GCS bucket routes, and records
  external callback changes.
- Deployment and rollback: INT-1637 has a no-cutover PR gate, replacement PR
  workflow, rollback steps, and this resource disposition review.
