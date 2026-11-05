# @particle-academy/prism

A TypeScript port of [Prism](https://github.com/Particle-Academy/prism), the
PHP/Laravel unified API layer over LLM providers.

Real TypeScript: promises, discriminated unions, strict null checking. What it
is *not* is a transliteration — the idioms are this language's. The corpus
records where provider behavior agrees and where it differs.

> **Working on this package?** Read **[`AGENTS.md`](AGENTS.md)** first — the boundary
> this package has to hold, the gates that must be green, and the traps that have
> already caught someone.
> `@link AGENTS.md`

## Scope

Streams from Anthropic, OpenAI and Mistral retain provider-reported usage when
an attempt fails. Read the immutable `StreamFailureUsage` from
`ErrorEvent.failureUsage`, or `PrismError.streamFailureUsage()` for an SDK-owned
read exception. Its `usage` includes all eight usage fields; `reportedFields`
distinguishes a reported zero from an unknown counter. These snapshots are
provisional, cover only the failed attempt and exclude completed steps.
`failure_usage` is omitted from serialization when no counter was reported.

Recognized malformed stream JSON now emits one `stream_decode_error`, including
when usage is unknown. Anthropic then ends with Error; OpenAI and Mistral emit no
fabricated terminal event. A foreign transport failure with reported usage emits
one error event before rethrowing the original exception. Successful accounting,
exception identity/cause and the serialized fields of pre-existing errors
without usage remain unchanged. Native multi-step stream/tool continuation is
still unsupported.

Stored assistant messages retain provider replay state in `additionalContent`:
OpenAI Responses uses `output_items`; Anthropic uses ordered `content_blocks`,
with `thinking_blocks` as a fallback. Keep that metadata when sending history
back. Signatures, redacted thinking and encrypted reasoning remain opaque and
unchanged; avoid logging these values. The legacy thinking/signature pair still
works when full replay metadata is absent.

In 0.5.0, Anthropic EOF before `message_stop` emits non-recoverable
`incomplete_stream` and a terminal Error event. Provider errors close unfinished
text and still end with Error; later stop/usage events cannot erase the error.
Terminal usage stays null unless a final usage delta arrived. Consumers should
handle these newly observable terminal events. Native event vocabulary and
payload differences are tracked separately in the
[stream comparison contract](https://github.com/Particle-Academy/prism-parity/blob/main/docs/streaming-conformance.md).

**Every capability the reference has**, and three of its eighteen providers.
That is the shape of the remaining drift: one axis, not two.

- **Capabilities — all of them.** `text`, `structured`, `stream`, `embeddings`,
  `images`, `moderation`, `audio` (`textToSpeech` and `speechToText`), `files`,
  `batch`, `fim`. A user message carries images and documents, and each provider
  spells them its own way.
- **Providers — `anthropic`, `mistral`, `openai`.** The OpenAI provider speaks
  the **Responses API**; Mistral brings the chat-completions shape, which is a
  different wire format rather than a variant of it.

Not included, and not stubbed: **the tool-execution loop** — a response that
finishes on tool calls is refused with `tool_loop_not_supported` rather than
half-executed — and the fifteen providers the reference has and this port does
not. Asking for one fails with the `unsupported_provider_action` code rather
than returning something plausible.

Not every capability reaches every provider, because not every provider has one.
`images`, `moderation`, `textToSpeech`, `files` and `batch` are OpenAI-only
here, and `fim` is Mistral-only because Mistral is the only provider that
implements it at all — in the reference as well. See the envelope's port gaps
register for which of those are work someone could do and which are facts about
the provider.

Every value object serialises **and rebuilds** — `toObject()` and a static
`fromObject()`. The PHP package has only the first half, which left each consumer
to invent the second; one of those inventions shipped a defect that corrupted
stored assistant messages. Both halves ship here, and the rebuild direction is
pinned by fixtures.

Failures carry a stable `code` (`PrismError.code`). The prose is not part of the
contract and will change; the code will not.

Structured responses retain `structured`, `steps`, `raw`, and the tool carrier
arrays when serialized with `toObject()`. Each exported `StructuredStep` also
retains its completed `messages` and per-step parsed value. Preserve that
conversation state when continuing a conversation. Anthropic uses native schema
output by default: `text` is empty while the original JSON remains in the
assistant message. Explicit structured tool mode is currently refused with
`unsupported_provider_action` before HTTP; it does not run tools.

## Install

```sh
npm install @particle-academy/prism
```

Node 22 or newer.

## Usage

```ts
import { Prism } from '@particle-academy/prism';

const response = await Prism.text()
  .using('openai', 'gpt-4o')
  .withSystemPrompt('You are terse.')
  .withPrompt('Who are you?')
  .asText();

console.log(response.text);
console.log(response.usage.promptTokens, response.usage.completionTokens);
```

Configuration is explicit first, environment second — `OPENAI_API_KEY`,
`OPENAI_URL`, `OPENAI_ORGANIZATION`, `OPENAI_PROJECT`, `OPENAI_API_FORMAT`:

```ts
Prism.text().using('openai', 'gpt-4o', { apiKey: 'sk-…', transport });
```

Omitting a field (`undefined`) reads its environment value, then the provider
default. An explicit empty string stays empty. Explicit `null` has the PHP
reference's field-specific behavior:

| Field | Explicit `null` |
| --- | --- |
| OpenAI `apiKey` / `apiFormat` | `''` / `'responses'` |
| OpenAI `organization` / `project`; Anthropic `betaFeatures` | Remains `null`; environment is ignored |
| Anthropic `url` | Default Anthropic URL |
| Anthropic `apiKey` / `apiVersion`; OpenAI `url`; Mistral `apiKey` / `url` | Refused with `TypeError` (also excluded by the TypeScript types) |

Environment strings follow Laravel's reserved spellings: case-insensitive
`null`, `true`, `false`, `empty` and their parenthesized forms become scalars;
matching surrounding quotes are removed. Direct constructor strings remain
literal. A non-string environment scalar is refused for a string-only field.
OpenAI supports only the Responses format; selecting another format still
raises `unsupported_provider_action` before HTTP.

Anthropic reads `ANTHROPIC_API_KEY`, `ANTHROPIC_URL`, `ANTHROPIC_API_VERSION`
and canonical `ANTHROPIC_BETA`. The old `ANTHROPIC_BETA_FEATURES` is used only
when neither explicit `betaFeatures` nor canonical `ANTHROPIC_BETA` is present.
Consuming that fallback emits one value-free deprecation warning per process.
An explicit `null` or empty canonical value prevents fallback consumption.

`defaultThinkingBudget` overrides `ANTHROPIC_DEFAULT_THINKING_BUDGET` (default
1024). The configured scalar is cast as in PHP. An integer per-request thinking
budget takes precedence; a string or fractional per-request budget uses the
configured fallback. No extra minimum budget is imposed by this port.

Default fetch transports use seconds: a nonstream request has a **30-second
total deadline**, including its body. A stream has a **30-second connection and
header deadline**, followed by Prism's **60-second idle limit per pending body
read**. It has no overall stream lifetime deadline. Request client options
`timeout` and `read_timeout` override those respective limits; zero disables
that limit. `signal` accepts caller cancellation through headers and body.
Injected transports own their timeout and cancellation behavior.

`fetchPublic({ timeout, signal })` applies its total budget across address
checks, redirects and body consumption. Its existing address policy and body
cap still apply; Node fetch does not pin the checked DNS answers to a connection.

Stream event timestamps now default to **Unix seconds**, including serialized
events. To construct a JavaScript date, use `new Date(event.timestamp * 1000)`.
An explicitly supplied timestamp is retained, including zero. See
[CHANGELOG.md](CHANGELOG.md) for the compatibility change.

`transport` is the seam between the provider and the network. Pass one and no
test ever touches a socket:

```ts
import type { HttpTransport } from '@particle-academy/prism';

const transport: HttpTransport = async (request) => ({
  status: 200,
  headers: {},
  body: recordedPayload,
  rawBody: JSON.stringify(recordedPayload),
});
```

Build a request without sending it, or parse a stored payload without HTTP:

```ts
import { buildRequestBody, canonicalJson, parseTextResponse } from '@particle-academy/prism';

const request = Prism.text().using('openai', 'gpt-4o').withPrompt('hi').toRequest();

canonicalJson(buildRequestBody(request)); // exactly the bytes that would be POSTed
parseTextResponse(request, recordedPayload); // the same parse a live call performs
```

## Parity

This port's behaviour is not defined by its own tests. It is pinned by
[**prism-parity**](https://github.com/Particle-Academy/prism-parity) — a
language-independent conformance corpus generated by executing the PHP
reference, which states the rules once so three implementations cannot each
drift into their own reading of them.

The corpus and its loader install as `@particle-academy/prism-conformance`. The
runner lives in [`conformance/runner.mjs`](conformance/runner.mjs) and implements
prism-parity's subprocess contract, so `scripts/cross-check.mjs` can run this
port and the others side by side and require **identical verdicts** — a stronger
claim than three suites that each went green alone.

```sh
git clone https://github.com/Particle-Academy/prism-parity .parity
npm install ./.parity/loaders/ts
npm run conformance                       # every suite
node conformance/runner.mjs --suite openai-text-request
node conformance/runner.mjs --probe omit-null-keys
```

Two rows diverge from the reference on purpose, and the corpus says which and
why: `trq-0021` and `trq-0022`, where the reference drops a prompt of `""` or
`"0"` and this port sends it. Read the corpus for the rest — restating its rules
here would only give them somewhere to drift.

### Probes

`--probe` runs the port with one deliberate defect injected, from the corpus's
`probes/probes.json`. Each probe declares the exact set of case ids it must fail,
and [`tests/probes.test.ts`](tests/probes.test.ts) asserts the observed set
*equals* it — not that it is non-empty. A table every plausible implementation
passes measures nothing.

The mutants live in [`conformance/mutations.mjs`](conformance/mutations.mjs),
outside `src/`: a defect you can switch on in production is a defect.

## Development

```sh
npm run build       # tsc → dist/
npm run typecheck
npm run lint
npm test
npm run conformance
```

## License

MIT. See [LICENSE](LICENSE).
