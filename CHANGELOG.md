# Changelog

## Unreleased

## 0.12.1 — 2026-11-27

- An assistant message's stored provider content (Anthropic `content_blocks`, OpenAI Responses `output_items`) no longer drops the message's tool calls that are missing from it. Each such call is now sent after the replayed content, so every tool result that follows has its tool call. On Anthropic the order stays thinking, then text, then tool_use.

## 0.12.0 — 2026-11-26

BREAKING CHANGE: A per-call provider `url` (`using(provider, model, { url })`) that points at a loopback, private, link-local or metadata address is now refused with `PrismUrlRefused` (`private_address_refused`) before the provider is built, so before any request; one that is not an absolute http or https url is refused with `scheme_not_allowed`. Every IPv4 spelling a resolver accepts (decimal, octal, hex, shortened), IPv4-mapped and NAT64/6to4 IPv6, and `localhost` / metadata hostnames are covered; the message never names the address. This applies to built-in, `configureProviders()` and `registerProvider()` providers. Configured urls (`OPENAI_URL`, `ANTHROPIC_URL`, `MISTRAL_URL`, the defaults, a compatible entry's `url`) may still point anywhere, and a per-call url naming the configured endpoint is not checked. Opt out in configuration only: `OPENAI_ALLOW_PRIVATE_PER_CALL_URL` / `ANTHROPIC_ALLOW_PRIVATE_PER_CALL_URL` / `MISTRAL_ALLOW_PRIVATE_PER_CALL_URL` set to `true`, a compatible entry's `allowPrivatePerCallUrl: true`, or `registerProvider(key, factory, { allowPrivatePerCallUrl: true })`. An `allowPrivatePerCallUrl` passed with a call is ignored. The check needs no DNS, so a hostname resolving to a private address is not caught.
- The per-call opt-out allows private addresses only. With it on, a per-call url that is not an absolute http or https url is still refused with `scheme_not_allowed`, and a host holding a percent escape, a backslash, an underscore, an IPv6 zone id, an invisible character or a non-ASCII character is still refused (`private_address_refused` or `non_ascii_host_use_punycode`, or the compatible entry's own url error), before the provider is built. It used to skip the whole check, so a `registerProvider()` factory could receive such a url.
- An ISATAP address behind a 6to4 prefix is judged by the IPv4 address it carries, in the guarded media fetch and the per-call url check alike; it used to be judged only by the 6to4 prefix. A per-call IPv6 literal with a trailing dot inside the brackets is refused.
- A per-call `url` host must be ASCII: an international name is given in its punycode (`xn--`) form, and any other non-ASCII host is refused with `PrismUrlRefused` (`non_ascii_host_use_punycode`) before any request. Invisible and formatting characters, `ß`, `ẞ` and `ς` anywhere before the path are refused with `private_address_refused`. An IPv6 literal written with a dotted IPv4 tail is judged like its hex spelling.
- The default transports follow a redirect only when the scheme, host and port are unchanged. A redirect to any other origin is not followed and fails with `PrismUrlRefused` (`redirect_refused`); nothing is sent to the second server. Same-origin redirects keep working, capped at 5 hops as in the reference (the sixth redirect fails with `too_many_redirects`); a Location carrying userinfo is refused with `redirect_refused`; a 303, or a 301/302 answering a POST, becomes a GET without a body. `withClientOptions({ redirect })` no longer changes this.
- A provider url carrying userinfo (`https://user@host/v1`) is still handed to `fetch`. When `fetch` refuses it, as Node's does, the call now fails with `PrismUrlRefused` (`scheme_not_allowed`) whose message does not repeat the url; it used to fail with a bare `TypeError` naming the url, userinfo included. An unparseable url is handled the same way. Nothing is sent either way.
- GET requests on the default binary transport (OpenAI file metadata, download and list, batch retrieve, list and results) no longer fail with "Request with GET/HEAD method cannot have body".
- `configureProviders()` registers named OpenAI-compatible providers (`driver: 'openai-compatible'`). Each sends only its own `apiKey`, `organization` and `project` and reads nothing from the environment; an entry with no key sends no `Authorization` header. A per-call `url` for a different endpoint drops the entry's credentials. The entry url must be an absolute http or https url (private addresses allowed in the entry; a private per-call url is refused unless the entry opts out, see above). Names follow `registerProvider()`'s allow-list and collision rules, and every entry is checked before any is registered (G-321 A).
- The OpenAI provider supports `apiFormat: 'chat_completions'` for text, structured and stream, posting the reference's request bodies to `<url>/chat/completions`. Tool-call replies are refused with `tool_loop_not_supported` without running the tool, unusable tool arguments follow the existing rules, and a document, audio or video part is refused with `unsupported_media` (G-321 D).
- `OpenAIConfig.ignoreEnvironment` builds an OpenAI provider from the passed values only.
- An unknown OpenAI `apiFormat` is now refused on `stream` as well as on `text` and `structured`; streaming used to ignore the format.
- `ToolCall.toObject()` no longer keeps the text of unusable arguments. Such a call is stored as `"arguments": "]"` with `"arguments_malformed": true`, as the PHP reference stores it, and that record (or any record marked `arguments_malformed`) is read back by `fromObject()` as a call with unusable arguments. Records of usable calls are unchanged. This applies to every record holding a call: messages, steps and responses.

## 0.11.0 — 2026-11-23

BREAKING CHANGE: `parsedArguments()` throws `malformed_tool_call_arguments` for a number, string, boolean, non-empty list or integer-keyed map. It used to return an empty object for the first four. An empty string, the text `0`, `null`, `[]` and `{}` still mean no arguments. Code that reads the arguments before running a tool should catch the error and return it to the model as a tool error, or check `hasMalformedArguments()` first.
BREAKING CHANGE: Arguments the PHP reference cannot decode are refused too: `NaN` and `Infinity`, a lone surrogate, and more than 500 nested containers.
BREAKING CHANGE: A stored tool call with unusable arguments and no tool result now fails when it is sent. Answer it with a tool result first.
- `ToolCall.hasMalformedArguments()` says whether a call's arguments are unusable.
- Once a later tool result answers such a call, it is sent back with empty arguments in each provider's own shape (OpenAI, Anthropic, Mistral), including stored OpenAI output items. The caller's messages are not modified.
- A call that nothing has answered fails at mapping with `malformed_tool_call_arguments` on every provider, now including Mistral.
- Tests now check that core has no approval check and never runs a tool handler.

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
