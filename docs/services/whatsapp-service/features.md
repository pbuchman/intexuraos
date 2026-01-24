# WhatsApp Service

Bridge between WhatsApp messaging and IntexuraOS workflows - receive messages, approve actions via replies, and get AI-transcribed voice notes.

## The Problem

Mobile productivity requires frictionless input methods. Traditional apps force context-switching - opening apps, navigating menus, typing carefully. When you're walking, driving, or in meetings, these barriers cause valuable ideas and tasks to slip away. WhatsApp is already in your pocket and muscle memory.

Additionally, approval workflows often require logging into dashboards or checking emails. When an automated action needs human approval, the delay between notification and response can bottleneck entire workflows.

## How It Helps

### Instant Message Capture

Send any message to your connected WhatsApp number - text, images, or voice notes. Everything is automatically stored, processed, and routed to the appropriate IntexuraOS service.

**Example:** Walking to lunch, you remember a research idea. Send "research quantum computing market trends 2026" via WhatsApp. By the time you return, the research-agent has gathered relevant articles and summarized findings.

### Voice Note Transcription with AI Summary

Speak your thoughts naturally. Voice notes are transcribed using Speechmatics, then enhanced with AI-generated summaries that extract key action items.

**Example:** Record a 90-second voice memo about a project status update. Within 30 seconds, you receive the full transcript plus a bullet-point summary highlighting "schedule meeting with vendor" and "review contract by Friday" as actionable items.

### Approval via Replies and Reactions

Respond to action approval requests directly in WhatsApp. Reply with text ("yes", "no", "approve") or use emoji reactions for instant decisions.

**Example:** The bookmarks-agent wants to add a URL to your reading list. You receive "Add 'AI Trends Report' to Reading List?" - reply with "yes" or react with thumbs-up to approve instantly, without leaving WhatsApp.

### Image Handling with Thumbnails

Share images that get stored securely in Cloud Storage with auto-generated thumbnails for fast preview loading.

**Example:** Snap a photo of a whiteboard during a meeting. The image is stored with a 256px thumbnail, accessible from any IntexuraOS interface for quick reference.

### Link Preview Extraction

URLs in your messages automatically trigger Open Graph metadata extraction, providing rich previews with titles, descriptions, and images.

**Example:** Send a link to an interesting article. The service extracts the title, author, featured image, and summary - making your bookmarks immediately useful without manual curation.

## Use Case: Mobile Action Approval

You're in transit when your todo-agent identifies a recurring task that should become automated:

1. WhatsApp notification arrives: "Create automation: 'Weekly team sync reminder' every Monday 9am?"
2. You react with thumbs-up emoji
3. Whatsapp-service correlates the reaction to the original approval message
4. ApprovalReplyEvent published to actions-agent
5. Automation is created without any app-switching

The entire interaction takes 2 seconds while you continue walking.

## Key Benefits

- **Zero friction capture** - WhatsApp is always accessible, no app switching required
- **Natural voice input** - AI transcription with smart summaries extracts actionable items
- **Instant approvals** - Emoji reactions or text replies for sub-second decisions
- **Automatic enrichment** - Link previews, thumbnails, and transcriptions happen automatically
- **Message correlation** - Outbound messages tracked via wamid for reliable reply threading

## Limitations

- **WhatsApp Business API required** - Meta Business verification and API access needed
- **24-hour messaging window** - WhatsApp limits proactive messages to 24 hours after last user message
- **No video support** - Video messages are currently ignored
- **Single phone number per user** - Each user maps to one WhatsApp number (multiple not yet supported)
- **Rate limits** - Subject to WhatsApp API rate limits (varies by tier)
- **No message editing** - Sent messages cannot be modified

---

_Part of [IntexuraOS](../overview.md) - Capture thoughts and approve actions from anywhere._
