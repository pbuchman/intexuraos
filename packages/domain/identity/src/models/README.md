# Identity Domain Models

Domain entities for the identity bounded context.

## Planned Models

- `User` - Core user identity
- `Session` - Authentication session state
- `AccessGrant` - Permission grants

## Guidelines

- Models are pure data structures with validation
- No external dependencies
- Immutable where possible
- Use Result types for fallible operations
