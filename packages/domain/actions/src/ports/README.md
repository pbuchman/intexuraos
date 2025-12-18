# Actions Domain Ports

Interfaces for external dependencies required by the actions domain.

## Planned Ports

- `ActionStorePort` - Action persistence interface
- `ExecutorPort` - Action execution interface
- `SchedulerPort` - Action scheduling interface

## Guidelines

- Ports define the contract, not implementation
- Use domain types in port signatures
