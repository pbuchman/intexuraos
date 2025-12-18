# PromptVault Domain Ports

Interfaces for external dependencies required by the promptvault domain.

## Planned Ports

- `PromptStorePort` - Prompt persistence interface
- `VersionControlPort` - Version management interface

## Guidelines

- Ports define the contract, not implementation
- Use domain types in port signatures
