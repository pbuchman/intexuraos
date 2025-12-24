You are tasked with generating high-quality, GitHub-style documentation and a professional README for this codebase.
Your output must be visually clean, technically complete, and better than this
benchmark: https://github.com/pbuchman/motorscope/blob/main/README.md

STARTING POINTS:

- Use the existing `README.md` and `docs/` directory for source content.
- Reference the Swagger UI for API definitions: https://intexuraos-api-docs-hub-ooafxzbaua-lm.a.run.app/docs

README STRUCTURE — must include, in this order:

1. **Header Section**
   - Project name and tagline
   - Badges for tech stack (Shields.io style, e.g. Node.js, PostgreSQL, Docker, CI)
   - Logo/icon from `docs/assets/branding` (centered or top-left)

2. **Overview**
   - 2–4 sentence description of what the project does and why it matters
   - Key use cases (bulleted)

3. **Core Features**
   - Bullet format using emojis (✅), e.g. `✅ Realtime data ingestion pipeline`

4. **Architecture**
   - Diagram (link or inline image) of the system architecture
   - Summary of components and responsibilities
   - Sequence diagrams for key flows (optional but recommended)
   - Failure modes and resilience patterns

5. **Authentication Flow**
   - Step-by-step explanation of auth (OAuth, tokens, refresh logic)
   - Token lifetimes and refresh edge cases
   - Logout/revocation flow
   - Diagram if needed

6. **API Overview**
   - Link to Swagger UI
   - Short description of available endpoints and flows
   - Mention API security (headers, scopes, etc.)
   - Pagination conventions, filtering syntax
   - Idempotency rules for mutating operations

7. **Error Handling**
   - Standard error response format (JSON structure)
   - HTTP status codes used and their meaning
   - Retry guidance for transient failures

8. **Data Management**
   - What data is stored, where (DB, cache, external sources)
   - Model examples or links to model definitions
   - Retention, cleanup, or sync mechanisms
   - Schema migration approach
   - PII handling and compliance notes (if applicable)

9. **External Data Sources**
   - Describe each source (e.g. APIs, webhooks), integration method, and usage
   - Rate limits and quotas from external services

10. **Security**
    - Required permissions/scopes per endpoint
    - Secrets management approach
    - Security contact for vulnerability reports

11. **Setup Guide**
    - Local setup (Node version, Docker if used)
    - `.env` file requirements (with defaults/required flags)
    - Installation commands
    - Run instructions
    - IDE configuration and debugger setup
    - Seed data instructions
    - Troubleshooting tips (brief)

12. **Testing**
    - How to run unit/integration/e2e tests
    - Coverage requirements and how to check
    - Test data setup instructions
    - Mocking strategy for external services

13. **Deployment & CI/CD**
    - Environment list (dev, staging, prod)
    - CI/CD pipeline overview
    - Rollback procedure
    - Release process

14. **Observability**
    - Log format and levels
    - Available metrics and their meaning
    - Health check endpoint behavior
    - Alerting runbooks (if applicable)

15. **Versioning & Changelog**
    - API versioning scheme (URL path, header, etc.)
    - Link to CHANGELOG.md
    - Deprecation policy and migration guides

16. **Contributing**
    - PR process and review expectations
    - Code style enforcement
    - Issue/bug report templates

17. **Copilot Configuration**
    - Link to `.github/` files
    - Describe any rules or workflows relevant to GitHub Copilot or Actions

18. **Documentation Map**
    - Bullet list or tree of key files/folders in `docs/`
    - Links to deeper guides

19. **Glossary**
    - Domain-specific terms and their definitions

20. **License**
    - State clearly: MIT License
    - Add license block or link to LICENSE file

STYLE & FORMAT:

- Use clean, semantic Markdown: `##`, `###`, bullet points, fenced code
- Prefer links to duplication (e.g., "see [API Guide](docs/api.md)")
- Tone: concise, technical, friendly — like a maintained open-source repo

ANTI-PATTERNS (avoid these):

- Stale screenshots or diagrams
- Dead links
- "TODO", "TBD", or placeholder text
- Undocumented environment variables
- Code examples that don't execute

QUALITY GATES — before considering documentation complete:

- [ ] All links resolve and return 2xx
- [ ] All code examples execute without error
- [ ] All env vars documented with defaults/required flag
- [ ] No "TODO", "TBD", or placeholder text
- [ ] Reviewed by someone unfamiliar with the codebase

GOAL: A fully structured, open-source-ready documentation suite with a polished README that is immediately useful to
new contributors or users.
