# LLM Orchestrator Module - Instructions

## Overview

Build a new "LLM Orchestrator" module allowing users to run research prompts across multiple LLMs (Gemini, GPT, Claude) with web browsing, then synthesize results. Fully asynchronous with WhatsApp notification on completion.

## Task Numbering

Files follow `[tier]-[sequence]-[title].md` pattern:

- **Tier 0**: Setup & Infrastructure (0-0, 0-1, 0-2, 0-3)
- **Tier 1**: Shared Packages - Independent (1-0, 1-1, 1-2, 1-3)
- **Tier 2**: Encryption + User Service Extension (2-0, 2-1, 2-2, 2-3, 2-4)
- **Tier 3**: LLM Orchestrator Domain (3-0, 3-1, 3-2, 3-3)
- **Tier 4**: LLM Orchestrator Infrastructure (4-0, 4-1, 4-2, 4-3)
- **Tier 5**: LLM Orchestrator Routes & Server (5-0, 5-1, 5-2, 5-3, 5-4)
- **Tier 6**: Frontend - Settings API Keys (6-0, 6-1, 6-2)
- **Tier 7**: Frontend - Orchestrator UI (7-0, 7-1, 7-2, 7-3, 7-4)
- **Tier 8**: Integration & Testing (8-0, 8-1, 8-2, 8-3, 8-4)

## Execution Process

1. Execute subtasks sequentially by tier
2. Update CONTINUITY.md after each subtask
3. Run `npm run ci` after each major tier
4. Tier 8-3 performs coverage verification
5. Tier 8-4 performs terraform validation

## Resume Procedure

On interruption:
1. Read CONTINUITY.md to restore state
2. Find "Now" section for current task
3. Continue from where left off
4. Append to ledger, never overwrite

## Success Criteria

- All subtasks completed
- `npm run ci` passes
- `terraform fmt -check -recursive` passes
- `terraform validate` passes
- Coverage thresholds met
- Archived to `continuity/archive/014-llm-orchestrator/`

## Key Decisions

1. **API Keys Storage**: Extend user-service (not separate collection)
2. **LLM Models**: Use real models with web capabilities
3. **WhatsApp Fallback**: Skip notification silently if not connected
4. **Encryption**: Add AES-256-GCM to common-core

## Reference

Full plan: `/Users/p.buchman/.claude/plans/valiant-singing-storm.md`
