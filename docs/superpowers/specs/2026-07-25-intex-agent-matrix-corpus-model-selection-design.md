# Intex Agent Matrix Corpus Model Selection Design

## Goal

Run the canonical production Matrix corpus with either DeepSeek V4 Flash or MiniMax M3
as the Intex Agent model while preserving the exact 20 scenarios, 59 turns, Matrix →
WhatsApp transport, strict mocked tools, and MiniMax M3 semantic evaluation.

## Decisions

- DeepSeek V4 Flash remains the default agent model for `matrix-corpus`.
- The production wrapper accepts one optional model selector:
  `--agent-model=or:minimax/minimax-m3`.
- Supported agent models are exactly:
  - `or:deepseek/deepseek-v4-flash`
  - `or:minimax/minimax-m3`
- The evaluator remains `or:minimax/minimax-m3` for every run.
- The selected agent model is immutable for the run and is included in the catalog
  digest, private run context, session profile, provider-usage proof, retained Test Run,
  JSON/Markdown report, and web presentation.
- Unsupported or malformed model selectors fail before any Matrix message, LLM call,
  capability creation, or run-state mutation.
- Existing invocations without a selector preserve the current DeepSeek behavior.

## Runtime Flow

1. The CLI parses the optional agent-model selector and builds the canonical catalog
   with that model.
2. Preflight verifies that the selected model is available in the production Intex
   Agent catalog.
3. Run registration persists the selected model in the immutable run context.
4. Scenario sessions copy the model into their Matrix corpus profile.
5. The production execution service passes the session model to its runner factory.
6. The runner factory constructs OpenRouter clients for that exact model.
7. Usage reconciliation rejects every provider call whose model differs from the
   session model.
8. The report and Test Runs UI display the selected agent model independently from the
   MiniMax evaluator model.

## Safety

- Strict tool mocks, expected schedules, confirmation behavior, and zero-production-
  executor proofs do not change.
- A run cannot mix agent models across scenarios or turns.
- MiniMax judging the MiniMax agent is allowed and remains visibly represented as two
  independent roles in the report.
- Cleanup, lease release, retention, and artifact delivery remain fail-closed.

## Testing

- CLI and wrapper tests cover the default, explicit MiniMax, malformed selector, and
  unsupported selector.
- Contract, persistence, context, session, runtime composition, report, and web decoder
  tests cover both supported agent models.
- Runtime tests prove that MiniMax creates MiniMax-bound clients and that provider usage
  is reconciled against the immutable model snapshot.
- The final acceptance proof is one production invocation with MiniMax M3 that completes
  20/20 scenarios and 59/59 turns with zero real executor admissions.

## Endpoint Changes

- Modified: protected Matrix corpus request and retained Test Run contracts broaden
  `agentModel` from the DeepSeek literal to the two-value supported union.
- Created: none.
- Removed: none.
- Unchanged: public regular-session endpoints, tool contracts, evaluator contract, and
  Test Runs route URLs.
