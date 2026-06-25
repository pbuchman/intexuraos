# Calendar Agent Technical Debt

## Current Watch Points

- Keep calendar event creation and failed-event recovery tested against Google API failures.
- Preserve explicit clarification behavior when Intex does not have enough event detail.
- Keep preview storage isolated from retired async topic flows.

## Future Work

- Revisit whether stored preview records are still needed for current dashboard flows.
- Add stronger timezone diagnostics for ambiguous natural-language event requests.

