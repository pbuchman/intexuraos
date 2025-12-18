# Identity Domain Ports

Interfaces for external dependencies required by the identity domain.

## Planned Ports

- `AuthPort` - Authentication provider interface
- `UserStorePort` - User persistence interface

## Guidelines

- Ports define the contract, not implementation
- Use domain types in port signatures
- Infra adapters implement these ports
