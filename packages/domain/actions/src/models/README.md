# Actions Domain Models

Domain entities for executable actions.

## Planned Models

- `Action` - Action definition with parameters
- `ExecutionState` - Action execution lifecycle state
- `ExecutionResult` - Action outcome with artifacts

## Guidelines

- Models are pure data structures with validation
- No external dependencies
- Immutable where possible
