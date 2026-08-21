# Internal Auth Rotation

Rotate `INTEXURAOS_INTERNAL_AUTH_TOKEN` as one destructive maintenance cutover.
There is no dual-token window or rollback.

1. Stop all DEV and PROD callers and validators, including transcription.
2. Generate a new token into a private mode-`0600` file outside the repository.
3. Build complete DEV and PROD package candidates containing the new token.
4. Add one new numeric version to the native
   `INTEXURAOS_INTERNAL_AUTH_TOKEN` container.
5. Publish new numeric DEV and PROD package versions.
6. Update every tracked package/native pin in one reviewed commit.
7. Deploy the same SHA to Home Dev, transcription, and production.
8. Start services only after package membership and native injection validate.
9. Run all internal callback, transcription, nginx, PM2, and browser smokes.
10. Destroy every older package version and native token version.
11. Delete private candidate files and record metadata-only evidence.

On failure, keep callers stopped, fix forward, and repeat the failed gate. Do
not restore the previous token or add a compatibility reader.
