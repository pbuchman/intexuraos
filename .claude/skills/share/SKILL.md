---
name: share
description: Publish HTML/markdown content to intexuraos.cloud/share/claude/. Supports rich HTML (via /frontend-design), styled markdown (GitHub-flavored), and raw markdown. Use when the user asks to share, publish, or make content available as a web page.
argument-hint: '[--html | --raw-md]'
---

<!-- Counterpart: .codex/skills/share/SKILL.md (Codex CLI version of this skill) -->
<!-- When updating this file, check whether the Codex version needs the same change. -->

# Share — Publish Content to GCS

Upload HTML or markdown content to the shared-content bucket, accessible at a public URL.

## Constants

```
Bucket:   intexuraos-shared-content-dev
Prefix:   claude/
Base URL: https://intexuraos.cloud/share/claude/
```

## Usage

```
/share              # Default: styled markdown mode
/share --html       # Rich HTML mode (invokes /frontend-design)
/share --raw-md     # Raw markdown (upload .md as-is)
```

## Mode Detection

Detect mode from user intent or explicit flags:

| Mode             | Trigger                                                        | Output  |
| ---------------- | -------------------------------------------------------------- | ------- |
| **Rich HTML**    | `--html`, "share as HTML", "publish this visualization"        | `.html` |
| **Styled MD**    | Default, "share this", "share as markdown"                     | `.html` |
| **Raw Markdown** | `--raw-md`, "share as clean markdown", "share as raw markdown" | `.md`   |

## Workflow

### Step 1: Generate Content

**Rich HTML mode:**

1. If the user references an **existing HTML file** that is already self-contained (all CSS inline, no external dependencies), use it directly — skip `/frontend-design`
2. Otherwise, invoke the `/frontend-design` skill to create a polished, self-contained HTML page
3. The HTML must be fully self-contained — all CSS inline, no external dependencies
4. Proceed to Step 2

**Styled Markdown mode (default):**

1. Take the markdown content the user wants to share
2. Wrap it in the GitHub-Style HTML Template (see below)
3. Proceed to Step 2

**Raw Markdown mode:**

1. Take the markdown content as-is
2. Proceed to Step 2 (upload as `.md` with `text/markdown` content type)

### Step 2: Generate Slug

Auto-generate a kebab-case slug from the content context. Examples:

- `auth-flow-diagram`
- `api-response-analysis`
- `deployment-architecture-overview`

Rules:

- Lowercase, kebab-case, no special characters
- 2-5 words, descriptive of content
- No dates or timestamps (unless the content is date-specific)

### Step 3: Write to Temp File

**If content comes from an existing file**, copy it directly (avoids heredoc quoting issues with large/complex files):

```bash
cp <source-file> /tmp/claude-share-<slug>.<ext>
```

**If content was generated** (from `/frontend-design` or markdown template), write via heredoc:

```bash
# For .html:
cat > /tmp/claude-share-<slug>.html << 'SHARE_EOF'
<content here>
SHARE_EOF

# For .md:
cat > /tmp/claude-share-<slug>.md << 'SHARE_EOF'
<content here>
SHARE_EOF
```

### Step 4: Check for Collisions

```bash
gsutil ls gs://intexuraos-shared-content-dev/claude/<slug>.<ext> 2>&1
```

- If output contains the file path: **collision detected** — append `-2`, `-3`, etc. and re-check
- If output contains `CommandException`: **no collision** — proceed

Loop until a unique slug is found.

### Step 5: Upload

```bash
# For HTML files:
gsutil -h "Cache-Control:public, max-age=3600" \
  -h "Content-Type:text/html; charset=utf-8" \
  cp /tmp/claude-share-<slug>.html \
  gs://intexuraos-shared-content-dev/claude/<slug>.html

# For raw markdown:
gsutil -h "Cache-Control:public, max-age=3600" \
  -h "Content-Type:text/markdown; charset=utf-8" \
  cp /tmp/claude-share-<slug>.md \
  gs://intexuraos-shared-content-dev/claude/<slug>.md
```

### Step 6: Verify, Clean Up, and Report

**Verify the upload succeeded** before reporting:

```bash
gsutil stat gs://intexuraos-shared-content-dev/claude/<slug>.<ext> 2>&1
```

- If output shows metadata (Content-Type, size, etc.): **upload confirmed**
- If output contains `No URLs matched`: **upload failed** — retry or report error to user

**Verify URL accessibility:**

```bash
curl -s -o /dev/null -w '%{http_code}' https://intexuraos.cloud/share/claude/<slug>.<ext>
```

- `200`: URL is live
- `404` or other: warn the user that the upload succeeded but the URL may not be accessible yet (CDN propagation, bucket permissions)

**Clean up:**

```bash
rm /tmp/claude-share-<slug>.<ext>
```

Then print the published URL to the user:

```
Published: https://intexuraos.cloud/share/claude/<slug>.<ext>
```

## Overwrite Behavior

- **Default:** If slug collides, generate a new unique slug (append `-2`, `-3`, etc.)
- **Explicit update:** Only overwrite an existing file if the user explicitly says "update that shared doc" or similar. In that case, skip collision check and upload directly to the same path.

## GitHub-Style HTML Template

Use this template for **Styled Markdown** mode. Replace `{{TITLE}}` with the first heading or a generated title, and `{{CONTENT}}` with the markdown content converted to HTML.

**IMPORTANT:** You must convert the markdown to HTML yourself before inserting into `{{CONTENT}}`. Render headings as `<h1>`-`<h6>`, paragraphs as `<p>`, code blocks as `<pre><code>`, inline code as `<code>`, lists as `<ul>`/`<ol>`, tables as `<table>`, links as `<a>`, bold as `<strong>`, italic as `<em>`, blockquotes as `<blockquote>`, and horizontal rules as `<hr>`.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{TITLE}}</title>
    <style>
      :root {
        --color-fg: #1f2328;
        --color-bg: #ffffff;
        --color-border: #d0d7de;
        --color-link: #0969da;
        --color-code-bg: #f6f8fa;
        --color-blockquote-fg: #656d76;
        --color-blockquote-border: #d0d7de;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --color-fg: #e6edf3;
          --color-bg: #0d1117;
          --color-border: #30363d;
          --color-link: #58a6ff;
          --color-code-bg: #161b22;
          --color-blockquote-fg: #8b949e;
          --color-blockquote-border: #30363d;
        }
      }
      * {
        box-sizing: border-box;
      }
      body {
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem 1.5rem;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 16px;
        line-height: 1.6;
        color: var(--color-fg);
        background: var(--color-bg);
      }
      h1,
      h2 {
        padding-bottom: 0.3em;
        border-bottom: 1px solid var(--color-border);
      }
      h1 {
        font-size: 2em;
        margin: 0.67em 0;
      }
      h2 {
        font-size: 1.5em;
        margin: 1em 0 0.5em;
      }
      h3 {
        font-size: 1.25em;
        margin: 1em 0 0.5em;
      }
      a {
        color: var(--color-link);
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      pre {
        background: var(--color-code-bg);
        border-radius: 6px;
        padding: 16px;
        overflow-x: auto;
        font-size: 85%;
        line-height: 1.45;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 85%;
      }
      :not(pre) > code {
        background: var(--color-code-bg);
        border-radius: 6px;
        padding: 0.2em 0.4em;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        margin: 1em 0;
      }
      th,
      td {
        border: 1px solid var(--color-border);
        padding: 6px 13px;
      }
      th {
        font-weight: 600;
        background: var(--color-code-bg);
      }
      blockquote {
        border-left: 4px solid var(--color-blockquote-border);
        color: var(--color-blockquote-fg);
        padding: 0 1em;
        margin: 1em 0;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      hr {
        border: none;
        border-top: 1px solid var(--color-border);
        margin: 1.5em 0;
      }
      ul,
      ol {
        padding-left: 2em;
      }
      li + li {
        margin-top: 0.25em;
      }
    </style>
  </head>
  <body>
    {{CONTENT}}
  </body>
</html>
```

## Fail Fast

Before uploading, verify `gsutil` is available:

```bash
gsutil version 2>&1 || echo "FAIL: gsutil not available"
```

If `gsutil` is not available, STOP and tell the user to install the Google Cloud SDK.
