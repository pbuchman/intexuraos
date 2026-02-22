# Share Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `/share` skill that publishes HTML/markdown content to `intexuraos.cloud/share/claude/<slug>.<ext>`.

**Architecture:** Pure Claude Code skill using `gsutil` for uploads to the existing `intexuraos-shared-content-dev` GCS bucket. Three modes: rich HTML (via `/frontend-design`), styled markdown (GitHub-style inline CSS template), and raw markdown. Terraform lifecycle scoped to keep `claude/` prefix content indefinitely.

**Tech Stack:** Claude Code skill (Markdown), `gsutil` CLI, Terraform (HCL)

---

### Task 1: Terraform — Scope Lifecycle Rule to `research/` Prefix

**Files:**
- Modify: `terraform/modules/shared-content/main.tf:25-32`

**Step 1: Edit the lifecycle rule to scope to `research/` prefix**

In `terraform/modules/shared-content/main.tf`, change the lifecycle rule from:

```hcl
  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type = "Delete"
    }
  }
```

to:

```hcl
  lifecycle_rule {
    condition {
      age            = 365
      matches_prefix = ["research/"]
    }
    action {
      type = "Delete"
    }
  }
```

This scopes the 365-day auto-delete to only `research/*` objects. Objects under `claude/` will persist indefinitely.

**Step 2: Run `terraform fmt`**

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/environments/dev fmt -recursive
```

Expected: files formatted (or "0 files formatted" if already correct).

**Step 3: Run `terraform plan`**

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/environments/dev plan
```

Expected: 1 change — `google_storage_bucket.shared_content` updated in-place (lifecycle rule condition changed).

**Step 4: Run `terraform apply`**

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform -chdir=terraform/environments/dev apply -auto-approve
```

Expected: `Apply complete! Resources: 0 added, 1 changed, 0 destroyed.`

**Step 5: Commit**

```bash
git add terraform/modules/shared-content/main.tf
git commit -m "infra: scope shared-content lifecycle to research/ prefix

Allows claude/ prefix objects to persist indefinitely while
research/ objects still auto-delete after 365 days.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Create the `/share` Skill

**Files:**
- Create: `.claude/skills/share/SKILL.md`

**Step 1: Create the skill directory**

```bash
mkdir -p .claude/skills/share
```

**Step 2: Write the skill file**

Create `.claude/skills/share/SKILL.md` with the full content below.

The skill must include:

1. **Frontmatter** — `name: share`, description referencing all three modes, `argument-hint`
2. **Constants** — bucket name, base URL, prefix
3. **Mode detection table** — three modes with triggers
4. **Rich HTML mode instructions** — invoke `/frontend-design`, then upload
5. **Styled Markdown mode** — complete GitHub-style HTML template (~50 lines of inline CSS, no external JS)
6. **Raw Markdown mode** — upload `.md` as-is
7. **Upload procedure** — slug generation, collision check via `gsutil ls`, suffix on collision, upload via `gsutil cp` with `Cache-Control` header, cleanup, print URL
8. **Collision handling** — if `gsutil ls` returns a match, append `-2`, `-3`, etc. and re-check

Key constants to embed:

```
Bucket: intexuraos-shared-content-dev
Prefix: claude/
Base URL: https://intexuraos.cloud/share/claude/
```

The GitHub-style template should include:

- `<meta charset="utf-8">` and `<meta name="viewport">`
- Body: `max-width: 800px`, `margin: 0 auto`, `padding: 2rem`, `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
- Headings: `border-bottom` on h1/h2, proper spacing
- Code blocks: `background: #f6f8fa`, `border-radius: 6px`, `padding: 16px`, `overflow-x: auto`, monospace font
- Inline code: `background: rgba(175,184,193,0.2)`, `border-radius: 6px`, `padding: 0.2em 0.4em`
- Tables: `border-collapse: collapse`, `th/td` with `border: 1px solid #d0d7de`, `padding: 6px 13px`
- Blockquotes: `border-left: 4px solid #d0d7de`, `color: #656d76`, `padding: 0 1em`
- Links: `color: #0969da`
- Light/dark mode support via `prefers-color-scheme: dark` media query with appropriate color inversions

**Step 3: Verify the skill is detected**

```bash
ls -la .claude/skills/share/SKILL.md
```

Expected: file exists with reasonable size (~200-300 lines).

**Step 4: Commit**

```bash
git add .claude/skills/share/SKILL.md
git commit -m "feat: add /share skill for publishing content to GCS

Supports three modes:
- Rich HTML via /frontend-design
- Styled markdown (GitHub-flavored HTML template)
- Raw markdown (explicit opt-in)

Uploads to intexuraos-shared-content-dev/claude/ prefix.
URLs at intexuraos.cloud/share/claude/<slug>.<ext>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Register Skill in CLAUDE.md

**Files:**
- Modify: `.claude/CLAUDE.md:626`

**Step 1: Add `/share` to the skills list**

In `.claude/CLAUDE.md`, find the line:

```
**Skills** (invoke via `/skill-name`): `/linear`, `/sentry`, `/document-service`, `/release`, `/coverage`, `/tech-debt-triage`
```

Change to:

```
**Skills** (invoke via `/skill-name`): `/linear`, `/sentry`, `/document-service`, `/release`, `/coverage`, `/tech-debt-triage`, `/share`
```

**Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: register /share skill in CLAUDE.md

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Smoke Test — Upload a Test File

**Step 1: Verify gsutil authentication works**

```bash
gsutil ls gs://intexuraos-shared-content-dev/
```

Expected: lists existing objects (research/ prefix files).

**Step 2: Upload a test file**

```bash
echo '<h1>Share Skill Test</h1><p>If you see this, the share skill infrastructure works.</p>' > /tmp/claude-share-test.html
gsutil -h "Cache-Control:public, max-age=3600" cp /tmp/claude-share-test.html gs://intexuraos-shared-content-dev/claude/test.html
rm /tmp/claude-share-test.html
```

Expected: `Copying file:///tmp/claude-share-test.html [Content-Type=text/html]...`

**Step 3: Verify the URL resolves**

```bash
curl -s -o /dev/null -w "%{http_code}" https://intexuraos.cloud/share/claude/test.html
```

Expected: `200`

**Step 4: Clean up test file**

```bash
gsutil rm gs://intexuraos-shared-content-dev/claude/test.html
```

**Step 5: Verify collision detection works**

```bash
# Upload a file
echo 'test' > /tmp/claude-share-collision.html
gsutil cp /tmp/claude-share-collision.html gs://intexuraos-shared-content-dev/claude/collision-test.html

# Check it exists
gsutil ls gs://intexuraos-shared-content-dev/claude/collision-test.html
# Expected: gs://intexuraos-shared-content-dev/claude/collision-test.html

# Check non-existent
gsutil ls gs://intexuraos-shared-content-dev/claude/nonexistent.html 2>&1
# Expected: CommandException: One or more URLs matched no objects.

# Cleanup
gsutil rm gs://intexuraos-shared-content-dev/claude/collision-test.html
rm /tmp/claude-share-collision.html
```

---

## Endpoint Changes

None. No HTTP endpoints created, modified, or removed.
