# Changelog

## Unreleased

## 0.10.0 — 2026-11-23

BREAKING CHANGE: Credentials are now scoped to their configured endpoint; a per-call URL override must supply its own key. Environment credentials (`OPENAI_API_KEY`, `OPENAI_ORGANIZATION`, `OPENAI_PROJECT`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`) apply only when the effective URL is the environment's URL or the provider default. Callers that pass a custom `url` and relied on the environment key must pass `apiKey` alongside it.
BREAKING CHANGE: `registerProvider()` refuses a key that is already registered, including built-in providers, unless `{ replace: true }` is passed. Keys are compared case-insensitively, and a key must match ASCII `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; any other key, including a homoglyph or full-width look-alike, is refused even with `{ replace: true }`.
BREAKING CHANGE: A provider `url`, per call or from the environment, that contains whitespace or a control character anywhere is refused with a `TypeError` before any request. It was previously trimmed for the endpoint comparison.

## 0.9.0 — 2026-11-05

BREAKING CHANGE: Default stream event timestamps use integer Unix seconds, matching the PHP reference. Previous defaults used milliseconds. Multiply by 1000 when constructing a JavaScript `Date`; explicit timestamps keep their supplied value.
BREAKING CHANGE: Provider configuration distinguishes omission, explicit `null` and an empty string per field. `null` no longer silently selects environment values for nullable fields. Invalid string-only null/scalar values are refused. See the README table before migrating callers that pass null placeholders.
- Read canonical `ANTHROPIC_BETA`; consume legacy `ANTHROPIC_BETA_FEATURES` only when needed, with one value-free deprecation warning. Honor configured/environment default thinking budgets while preserving integer per-request precedence.
- Enforce default fetch deadlines: nonstream total 30 seconds; streaming headers 30 seconds and pending body reads 60 idle seconds, with no whole-stream lifetime limit. Honor overrides and caller cancellation; release abandoned bodies and keep guarded media cleanup within its total deadline.
- Add native-backed provider configuration and FIM corpus coverage. Existing G43 offset and G125 native stream trace divergences remain open.

- Pin conformance to merged corpus 0.1.19 (`ae4b68bb923ac74030a5d88a924fdf1f09675caa`) with 162 native provider-configuration/FIM cases.
