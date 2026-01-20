# Linear Agent - Features

## Value Proposition

Seamlessly connect your voice to your issue tracker. Speak a task description via WhatsApp, and the Linear Agent uses AI to extract structured issue data and create it directly in Linear.

## The Problem

Creating Linear issues from mobile requires context-switching: open the app, navigate to the right team, fill out multiple fields. When you have a quick idea during a meeting or commute, that friction means the task either gets lost or gets created with minimal detail.

## How It Helps

Linear Agent bridges the gap between natural conversation and structured project management:

- **Voice-to-Issue Pipeline**: Speak naturally about what needs to be done
- **AI-Powered Extraction**: Gemini 2.5 Flash or GLM-4.7 extracts title, priority, and description
- **Automatic Priority Detection**: Understands urgency from context ("urgent", "when you have time", "blocker")
- **Structured Output**: Generates proper functional requirements and technical details sections

## AI Capabilities

| Capability               | Technology                 | Purpose                         |
| ------------------------ | -------------------------- | ------------------------------- |
| Issue Data Extraction    | Gemini 2.5 Flash / GLM-4.7 | Parse natural language to issue |
| Priority Classification  | LLM Inference              | Detect urgency from context     |
| Requirements Structuring | Prompt Engineering         | Generate FR/TD sections         |

## Use Cases

### Quick Task Capture

Voice note: "I need to fix the login button on mobile, it's not responding to taps on iOS"

Result:

- Title: "Fix unresponsive login button on iOS mobile"
- Priority: Normal (3)
- Functional Requirements: "Login button must respond to tap events on iOS devices"
- Technical Details: "Investigate touch event handling in React Native iOS build"

### Urgent Bug Report

Voice note: "URGENT - Production is down, the API gateway is returning 502 errors"

Result:

- Title: "Production API Gateway 502 Errors"
- Priority: Urgent (1)
- Description: Detailed incident context

### Feature Request

Voice note: "When you have time, it would be nice to have dark mode in the settings"

Result:

- Title: "Add dark mode toggle to settings"
- Priority: Low (4)

## Key Benefits

| Benefit               | Description                                      |
| --------------------- | ------------------------------------------------ |
| Zero-Context-Switch   | Create issues without leaving WhatsApp           |
| Consistent Quality    | AI ensures every issue has proper structure      |
| Priority Accuracy     | Natural language maps to Linear's 5-level scale  |
| Idempotent Processing | Duplicate messages won't create duplicate issues |
| Failure Recovery      | Failed extractions saved for manual review       |

## Limitations

- Requires Linear API key and team selection during setup
- Complex multi-issue descriptions may extract only the primary task
- Priority inference depends on explicit cues in the message
- Maximum input text length: 4000 characters
