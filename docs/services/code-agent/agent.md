# Code Agent Reference

Code Agent owns autonomous code task creation, task lifecycle state, GitHub automation, Linear synchronization, worker dispatch, and task logs.

## Supported Task Submission

- Public web/API task creation routes.
- Internal direct task creation from Intex and other trusted services.
- GitHub PR comments and webhook-driven follow-up tasks.
- Linear assignment-triggered task creation.

The retired action-status callback path is gone. Code Agent no longer mirrors task state to a separate action resource.

## Key Boundaries

- Code tasks default to planning mode unless execution mode is explicitly requested.
- Design review before implementation remains a quality gate.
- Worker dispatch stays HMAC-signed and container isolated.
- Internal endpoints must call `logIncomingRequest()` before auth validation.

