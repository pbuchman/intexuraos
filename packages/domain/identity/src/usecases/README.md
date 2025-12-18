# Identity Domain Use Cases

Application services that orchestrate domain logic.

## Planned Use Cases

- `ValidateToken` - Validate and decode authentication tokens
- `GetUserProfile` - Retrieve user profile with permissions

## Guidelines

- Use cases coordinate models and ports
- Return Result types for all operations
- No direct external service calls (use ports)
