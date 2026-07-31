# Mobile Digest Removal Review Remediation

## Finding

The removal verifier treats a missing `--root`, Mobile source tree, Mobile `package.json`, or package
root export as an empty clean input. A mistyped CI path or deleted audit target could therefore pass
without checking the repository.

## Plan

1. Add RED tests for a missing root and for every required audit input: Mobile source directory,
   signature-hash allowlist file, Mobile package manifest, internal-clients root export, and
   llm-prompts root export. Add a wrong-file-type case.
2. Validate the required layout before collecting source or dependency findings. Missing paths and
   wrong path types must be verifier failures with the exact path in diagnostics.
3. Re-run the verifier suite, repository verifier, Mobile removal/ordinary-route tests, typecheck,
   lint, and diff check.
4. Request a read-only re-review of the focused remediation; no implementation is delegated.
