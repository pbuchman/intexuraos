# Environment Standardization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize environment detection to only dev/prod, removing "local" references and adding clear URL-based signals.

**Architecture:** Update CLAUDE.md Environments section with detection signals table, update related reference docs, and prepare structure for future environment skill.

**Tech Stack:** Markdown documentation

---

## Task 1: Update CLAUDE.md Environments Section

**Files:**
- Modify: `.claude/CLAUDE.md:572-634`

**Step 1: Replace the Environments table**

Replace lines 572-579 with:

```markdown
## Environments

| Environment | Domain               | Infra                 | Machine  | Deploy Target            |
| ----------- | -------------------- | --------------------- | -------- | ------------------------ |
| **dev**     | dev.intexuraos.cloud | PM2                   | home-dev | `~/deploy/intexuraos`    |
| **prod**    | intexuraos.cloud     | Cloud Run / Functions | GCloud   | CI/CD via GitHub Actions |

**⛔ There is NO "local" environment. Only dev and prod exist. If you think about local, STOP - you are wrong.**
```

**Step 2: Replace the detection table**

Replace lines 580-589 with:

```markdown
**Environment detection signals:**

| Signal                               | dev                       | prod                                   |
| ------------------------------------ | ------------------------- | -------------------------------------- |
| URL contains                         | `dev.intexuraos.cloud`    | `intexuraos.cloud` (without `dev.`)    |
| URL contains                         | `localhost:*`             | `*.run.app`                            |
| User says                            | "dev", "dev environment"  | "prod", "production", "cloud"          |
| `uname -n`                           | `home-dev`                | N/A (Cloud Run)                        |
| Logs via                             | `pm2 logs <name>`         | `gcloud logging read`                  |
| `INTEXURAOS_ENVIRONMENT` env var     | `dev`                     | `prod`                                 |
```

**Step 3: Replace the Dev/Prod usage section**

Replace lines 590-594 with:

```markdown
**Firestore is SHARED between both environments.** Same database, same collections.

**Credentials source of truth:** GCP Secret Manager
- **prod:** Uses secrets directly from Secret Manager
- **dev:** Syncs secrets + overrides via `.envrc.local`
```

**Step 4: Update Environment Awareness section**

Replace lines 595-604 with:

```markdown
### ⛔ Environment Awareness — BEFORE Investigating Any Runtime Issue

**RULE: Identify WHERE the issue is happening before investigating.** Wrong assumptions waste time.

```
STEP 1: Check the URL/context. Does it contain dev.intexuraos.cloud or localhost? → dev
STEP 2: Does it contain intexuraos.cloud (no dev.) or *.run.app? → prod
STEP 3: For code tasks: check Firestore `code_tasks` collection for workerLocation field
STEP 4: Check service status with the right tool (pm2 for dev, gcloud for prod)
```
```

**Step 5: Update on-home-dev section**

Replace lines 605-626 with:

```markdown
**On home-dev (dev environment):**

| Component                 | Manager | Commands                                                         |
| ------------------------- | ------- | ---------------------------------------------------------------- |
| Apps (18 services + web)  | PM2     | `pm2 status`, `pm2 logs <name>`, `pm2 restart <name>`            |
| Orchestrator              | systemd | `sudo systemctl status/restart intexuraos-orchestrator@pbuchman` |
| Workers (cloud functions) | Direct  | `pnpm dev` (tsx watch) or `node dist/index.js`                   |

**Orchestrator is NOT in PM2.** Runs under systemd. Check with `systemctl status`, not `pm2 status`.

**Auto-deploy via webhook handler.** Push to `development` branch → webhook at `~/tools/webhook-handler/` → affected services restart.
```

**Step 6: Replace forbidden assumptions**

Replace lines 627-634 with:

```markdown
### Development Machines

| Machine      | OS     | Role                                         | SSH Access                  |
| ------------ | ------ | -------------------------------------------- | --------------------------- |
| **mac-dev**  | Darwin | Code editing, commits, pushes                | Can SSH to home-dev         |
| **home-dev** | Linux  | Runs dev environment, auto-deploys on push   | Has dev services running    |

**Both use `~/deploy/intexuraos/` as project path (relative to home).**

**Code Task Investigation:** For any code task issue, FIRST check the Firestore `code_tasks` document for the task. The `workerLocation` field shows which machine the orchestrator ran on (home-dev or mac-dev).

**Forbidden assumptions:**

- "This is local" — WRONG. There is NO local. Only dev or prod.
- "Platform is darwin therefore home-dev" — WRONG. darwin = mac-dev, home-dev is Linux.
- "This is a prod issue" — verify first by checking URL or logs source.
- "I can't access that service" — on home-dev, you CAN. It's localhost.
- "We need to restart/deploy" — webhook auto-deploys on push. Just push.

---
```

**Step 7: Verify changes**

Run: `grep -n "local" .claude/CLAUDE.md | grep -i environment`
Expected: No results mentioning "local environment"

**Step 8: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: standardize environment detection to dev/prod only

- Remove 'local' environment completely
- Add URL-based detection signals
- Document dev machines (mac-dev, home-dev)
- Add code task workerLocation check
- Document shared Firestore and credential flow"
```

---

## Summary

This single task updates CLAUDE.md with:
1. Removes all "local" environment references
2. Adds URL-based detection table (dev.intexuraos.cloud vs intexuraos.cloud)
3. Documents two development machines and their roles
4. Adds code task investigation protocol (check workerLocation in Firestore)
5. Clarifies shared infrastructure (Firestore, credentials)
