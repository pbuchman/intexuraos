# Linear Agent - Technical Debt

## Summary

| Category           | Count | Severity |
| ------------------  | -----  | --------  |
| TODOs/FIXMEs       | 0     | -        |
| Test Coverage Gaps | 1     | Medium   |
| TypeScript Issues  | 0     | -        |
| Code Smells        | 0     | -        |

## Future Plans

Based on code analysis and domain patterns:

1. **Webhook Integration**: Add Linear webhooks for bidirectional sync
2. **Issue Updates**: Support updating existing issues from WhatsApp
3. **Project Selection**: Allow users to select target project (not just team)
4. **Label Inference**: Extract labels from natural language context
5. **Due Date Extraction**: Parse relative dates ("by Friday", "next week")

## Test Coverage Gaps

### Integration Tests

- [ ] Linear API client mock coverage for error scenarios
- [ ] Extraction service with various input formats

## Code Quality Notes

### Positive Patterns

1. **Idempotency**: ProcessedAction repository prevents duplicate issue creation
2. **Graceful Degradation**: Failed extractions saved for manual review
3. **Type Safety**: Strict TypeScript types for Linear priority enum
4. **Error Mapping**: Consistent error code translation to HTTP status

### Areas for Improvement

1. **Batch Processing**: Currently processes one action at a time
2. **Caching**: Linear connection could be cached to reduce Firestore reads

## Resolved Issues

_No previously tracked issues._

---

**Last Updated:** 2026-01-19
