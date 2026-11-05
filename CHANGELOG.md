# Changelog

## Unreleased

- **Breaking:** default stream event timestamps use integer Unix seconds, matching the PHP reference. Previous defaults used milliseconds. Multiply by 1000 when constructing a JavaScript `Date`; explicit timestamps keep their supplied value.
- **Breaking:** provider configuration distinguishes omission, explicit `null` and an empty string per field. `null` no longer silently selects environment values for nullable fields. Invalid string-only null/scalar values are refused. See the README table before migrating callers that pass null placeholders.
- Read canonical `ANTHROPIC_BETA`; consume legacy `ANTHROPIC_BETA_FEATURES` only when needed, with one value-free deprecation warning. Honor configured/environment default thinking budgets while preserving integer per-request precedence.
- Enforce default fetch deadlines: nonstream total 30 seconds; streaming headers 30 seconds and pending body reads 60 idle seconds, with no whole-stream lifetime limit. Honor overrides and caller cancellation; release abandoned bodies and keep guarded media cleanup within its total deadline.
- Add native-backed provider configuration and FIM corpus coverage. Existing G43 offset and G125 native stream trace divergences remain open.
