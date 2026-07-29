# WhatsApp Message Digests — Fishing Retrieval Matcher Remediation

**Status:** Complete

**Observed behavior:** The exact allowed WhatsApp message is present with the expected source type,
local date, and author, but the test rejects it because `arrayContaining` compares its plain object
element as a complete value. The runtime evidence correctly carries additional required fields.

**Decision:** Wrap the expected partial evidence item in `expect.objectContaining`. Do not change
runtime behavior.

**Verification:** The focused retrieval suite passes 15/15. Package typecheck now reaches the two
planned caller migrations (`sendChatMessage` and `chatsRoutes`), which are the next Task 2 step.
