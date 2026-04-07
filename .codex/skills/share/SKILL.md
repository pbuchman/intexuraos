---
name: share
description: Use when the user asks to share, publish, or make HTML or markdown content available at a public URL.
argument-hint: '[--html | --raw-md]'
---

<!-- Counterpart: .claude/skills/share/SKILL.md (Claude Code version of this skill) -->
<!-- When updating this file, check whether the Claude Code version needs the same change. -->

# Share

## Overview

Publish HTML or markdown content to the shared-content bucket and return a public URL.

Current target:

```text
Bucket:   intexuraos-shared-content-dev
Prefix:   claude/
Base URL: https://intexuraos.cloud/share/claude/
```

Keep the `claude/` prefix unless the user explicitly asks for a different namespace. That is the path the existing shared-content flow already uses.

## When to Use

- User says `share`, `publish`, `make this public`, `give me a link`, or `host this as a page`
- User wants an HTML page, rendered markdown page, or raw markdown file at a public URL
- User already has a self-contained `.html` or `.md` file and wants it uploaded

Do not use this for private storage or internal-only artifacts.

## Mode Selection

Choose the mode from explicit flags or user intent.

| Mode            | Trigger                                                                        | Output  |
| --------------- | ------------------------------------------------------------------------------ | ------- |
| Rich HTML       | `--html`, "share as HTML", "publish this visualization", existing `.html` file | `.html` |
| Styled Markdown | Default, "share this", "share as markdown", prose/report content               | `.html` |
| Raw Markdown    | `--raw-md`, "share raw markdown", "upload the markdown file"                   | `.md`   |

## Workflow

### 1. Prepare the content

**Rich HTML mode**

1. If the user points to an existing self-contained HTML file, use it directly.
2. Otherwise create a self-contained HTML page first.
3. Keep all CSS inline and avoid external dependencies.

Note: do not rely on a `/frontend-design` command. In Codex, create the HTML artifact directly in the repo or temp space.

**Styled Markdown mode**

1. Take the markdown content.
2. Convert it to HTML.
3. Wrap it in the GitHub-style template below.

**Raw Markdown mode**

1. Use the markdown as-is.
2. Upload it with `text/markdown`.

### 2. Generate the slug

Create a descriptive kebab-case slug.

Examples:

- `auth-flow-diagram`
- `api-response-analysis`
- `hyperagents-implementation-map`

Rules:

- Lowercase
- Kebab-case
- 2 to 5 words
- No timestamps unless the content is date-specific

### 3. Write to a temp file

If using an existing file, copy it:

```bash
cp <source-file> /tmp/codex-share-<slug>.<ext>
```

If generating content, write it to:

```bash
/tmp/codex-share-<slug>.html
/tmp/codex-share-<slug>.md
```

### 4. Check for collisions

```bash
gsutil ls gs://intexuraos-shared-content-dev/claude/<slug>.<ext> 2>&1
```

- If the object exists, append `-2`, `-3`, and retry
- If `gsutil` reports no match, proceed

Only overwrite an existing object if the user explicitly asked to update that exact shared document.

### 5. Upload

HTML:

```bash
gsutil -h "Cache-Control:public, max-age=3600" \
  -h "Content-Type:text/html; charset=utf-8" \
  cp /tmp/codex-share-<slug>.html \
  gs://intexuraos-shared-content-dev/claude/<slug>.html
```

Raw markdown:

```bash
gsutil -h "Cache-Control:public, max-age=3600" \
  -h "Content-Type:text/markdown; charset=utf-8" \
  cp /tmp/codex-share-<slug>.md \
  gs://intexuraos-shared-content-dev/claude/<slug>.md
```

### 6. Verify

Verify object upload:

```bash
gsutil stat gs://intexuraos-shared-content-dev/claude/<slug>.<ext> 2>&1
```

Verify public URL:

```bash
curl -s -o /dev/null -w '%{http_code}' https://intexuraos.cloud/share/claude/<slug>.<ext>
```

- `200` means the URL is live
- `404` can mean propagation delay; report that clearly

### 7. Clean up and report

```bash
rm /tmp/codex-share-<slug>.<ext>
```

Return:

```text
Published: https://intexuraos.cloud/share/claude/<slug>.<ext>
```

## GitHub-Style Template

Use this for styled markdown uploads after converting the markdown body to HTML.

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
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --color-fg: #e6edf3;
          --color-bg: #0d1117;
          --color-border: #30363d;
          --color-link: #58a6ff;
          --color-code-bg: #161b22;
          --color-blockquote-fg: #8b949e;
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
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
      }
      th,
      td {
        border: 1px solid var(--color-border);
        padding: 6px 13px;
      }
      blockquote {
        margin: 0;
        padding: 0 1em;
        color: var(--color-blockquote-fg);
        border-left: 0.25em solid var(--color-border);
      }
      img {
        max-width: 100%;
        height: auto;
      }
    </style>
  </head>
  <body>
    {{CONTENT}}
  </body>
</html>
```

## Failure Handling

- If `gsutil` is missing, say so and stop instead of pretending the upload worked
- If upload succeeds but URL verification returns non-`200`, report the object path and the likely propagation issue
- If the source HTML is not self-contained, fix it before upload
