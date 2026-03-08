# Image Service

Give it your text, get back a professional image — no prompt engineering required.

## The Problem

AI-generated content deserves a visual identity, but creating one is surprisingly hard. Writing an effective image generation prompt is a skill most people do not have and should not need. You know what your research is about — you should not also have to know how to describe it to an image model in language that produces a clean, professional result. And once the image exists, you still need a thumbnail for cards, previews, and social sharing. That is two problems masquerading as one.

## Use Case

You finish a research report on renewable energy policy in Southeast Asia. You hit "share" and a public link is generated. Behind the scenes, the image-service reads your research content, understands the subject and tone, writes its own optimized prompt, and generates a cover image that fits — a clean visual of wind turbines against a tropical landscape, perhaps, or an abstract energy grid illustration. A thumbnail is produced automatically alongside the full-size version, sized for preview cards. The shareable page loads with a professional cover image you never had to think about.

Later, you decide to unshare the research. The cover image is cleaned up automatically — no orphaned files, no storage clutter.

## How It Helps

### Two-Step Generation Pipeline

Image-service works in two stages. First, it reads your raw text and generates an optimized image prompt — translating your content into the specific language that image models respond to best. Then, a separate image generation model creates the actual image from that prompt. You never write, see, or edit the prompt. The service handles the translation from "what you wrote" to "what looks good" entirely on its own.

### Automatic Thumbnailing

Every generated image is accompanied by a thumbnail — a 256-pixel JPEG optimized for cards, previews, and sharing surfaces. No second request, no manual resizing. Full-size and thumbnail are created together, every time.

### Cleanup on Unshare

When you unshare a piece of research, the associated cover image is deleted from storage and from the database. No orphaned files accumulate. The system stays clean without manual intervention.

### Works Without Your Own API Keys

If you have configured your own provider API keys, the service uses them — keeping costs under your control. If you have not, the platform provides fallback keys automatically, so image generation works from day one with no setup required.

### Human-Readable File Paths

When a title is provided, the generated image receives a readable file name derived from the content rather than a meaningless identifier. This keeps storage organized and debuggable.

## Key Benefits

- **Context-aware generation** — Understands your text and produces a matching image without manual prompt writing
- **Invisible prompt engineering** — The two-step pipeline handles the hard part so you do not have to
- **Thumbnail included** — Every image ships with a 256px preview, ready for cards and social sharing
- **Automatic cleanup** — Unsharing removes both storage and database records, preventing orphans
- **Zero-configuration start** — Platform fallback keys mean image generation works before users add their own API keys
- **User-controlled costs** — When users bring their own keys, their keys are used

## Limitations

- **Works behind the scenes** — End users never interact with this service directly; it runs in the background, called by other agents like research-agent
- **Fallback model limits** — Platform-provided keys work for all users, but may use different models or have lower rate limits than your own provider keys
- **No image editing** — Generates new images only; cannot crop, filter, or modify an existing image
- **No style selection** — You cannot choose artistic styles, color palettes, or visual themes; the service decides what fits the content
- **Generation takes a few seconds** — The two-step pipeline (prompt creation then image generation) adds processing time
- **No variations** — Cannot produce multiple options or alternative versions of an image

---

_Part of [IntexuraOS](../overview.md) — Your content, visualized._
