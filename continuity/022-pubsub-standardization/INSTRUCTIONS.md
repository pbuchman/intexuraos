# Pub/Sub Standardization

## Goal

Eliminate code duplication and inconsistencies in Pub/Sub publisher implementations across the codebase.

## Scope

- Create shared `BasePubSubPublisher` in `@intexuraos/infra-pubsub`
- Consolidate `PublishError` type definitions
- Standardize event type naming conventions
- Remove duplicated `SendMessageEvent` definition
- Fix hardcoded topic names in commands-router

## Out of Scope

- Changing Pub/Sub topic/subscription configurations in Terraform
- Modifying message retention or retry policies
- Adding new Pub/Sub functionality

## Success Criteria

1. All publishers extend `BasePubSubPublisher`
2. Single `PublishError` type imported from `@intexuraos/infra-pubsub`
3. No duplicated publisher boilerplate code
4. All event types follow `{domain}.{entity}.{action}` naming
5. `npm run ci` passes
6. No behavior changes (purely refactoring)

## Constraints

- Maintain backward compatibility with existing event consumers
- Keep domain layer pure (no infrastructure imports in domain)
- All changes must be covered by existing tests
