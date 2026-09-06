# IntexuraOS DEV Hibernation Plan — Amendment 4

## Status

Accepted by the user's instruction on 2026-08-29: `Nie potrzebujemy testu reaktywacji. Szybko
kończ bez zbędnych problemów`.

## Purpose

Remove the live DEV reactivation and re-hibernation drill from the accepted execution scope while
preserving the reversible configuration and documented recovery procedure.

## Exact plan changes

1. Remove Milestone M10, including M10.1, M10.2, and M10.3, from the execution and evidence gates.
   Do not start the hibernated DEV runtime merely to prove that it can be resumed.
2. Keep the tracked active, draining, and hibernated profiles, last-good revision data, dry-run
   validation, rollback instructions, and retained credentials/configuration needed for a later
   operator-authorized resume.
3. In M11.1, replace requirements for M10 artifacts and a completed resume drill with evidence
   that the recovery configuration and runbook remain present, internally consistent, and covered
   by non-mutating tests.
4. The 24-hour M9.2 observation, production/Matrix cutover, retained GitHub runner health, final
   hibernated state, and final evidence PR remain required.

## Acceptance effect

This amendment is a scope reduction only. It does not authorize an external provider mutation,
production deployment, Cloudflare apply, live canary, dirty-checkout replacement, or service stop
that otherwise requires a just-in-time confirmation.
