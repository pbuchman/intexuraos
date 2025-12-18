# Firestore Adapters

Implementations of domain ports using Firestore.

## Planned Adapters

- `FirestoreUserStoreAdapter` - Implements `UserStorePort` from identity domain

## Guidelines

- Adapters implement domain port interfaces
- Map Firestore types to domain types
- Handle Firestore-specific errors and map to domain errors
