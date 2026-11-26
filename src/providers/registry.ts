import { PrismError } from '../errors.js';
import { assertPerCallUrl } from '../internal/per-call-url.js';
import { assertCleanUrl, environmentFlag, environmentUrl, sameEndpoint } from '../internal/provider-config.js';
import type { Provider } from './provider.js';
import { Anthropic, DEFAULT_URL as ANTHROPIC_URL } from './anthropic/anthropic.js';
import type { AnthropicConfig } from './anthropic/anthropic.js';
import { Mistral, DEFAULT_URL as MISTRAL_URL } from './mistral/mistral.js';
import type { MistralConfig } from './mistral/mistral.js';
import { OpenAI, DEFAULT_URL as OPENAI_URL } from './openai/openai.js';
import type { OpenAIConfig } from './openai/openai.js';

export type ProviderFactory = (config: Record<string, unknown>) => Provider;

const providers = new Map<string, ProviderFactory>([
  ['anthropic', (config) => new Anthropic(config as AnthropicConfig)],
  ['mistral', (config) => new Mistral(config as MistralConfig)],
  ['openai', (config) => new OpenAI(config as OpenAIConfig)],
]);

/**
 * Who may choose a provider's address for ONE call. Held per key, read from
 * configuration only, and checked by `resolveProvider()` before the factory
 * runs. A per-call `allowPrivatePerCallUrl` is never read.
 *
 * @internal
 */
export interface PerCallUrlPolicy {
  /** The configured url, or null when there is none (a custom provider). */
  configuredUrl(): string | null;
  /** The configuration opt-out; read on every call, never from the call. */
  allowPrivatePerCallUrl(): boolean;
  /** A provider's own url check, run first so its error is kept. */
  assertUrl?(url: unknown): void;
}

/** Built-ins: `<PREFIX>_URL` or the default, and `<PREFIX>_ALLOW_PRIVATE_PER_CALL_URL`. */
function builtInPolicy(prefix: string, fallback: string, nullFallback?: string): PerCallUrlPolicy {
  return {
    configuredUrl: () => environmentUrl(`${prefix}_URL`, fallback, nullFallback),
    allowPrivatePerCallUrl: () => environmentFlag(`${prefix}_ALLOW_PRIVATE_PER_CALL_URL`),
  };
}

// An object, not `[key, value]` lines: agent/agent.mjs reads the provider
// list from the `providers` map's line shape, and must not count these twice.
const policies = new Map<string, PerCallUrlPolicy>(Object.entries({
  anthropic: builtInPolicy('ANTHROPIC', ANTHROPIC_URL, ANTHROPIC_URL),
  mistral: builtInPolicy('MISTRAL', MISTRAL_URL),
  openai: builtInPolicy('OPENAI', OPENAI_URL),
}));

export interface RegisterProviderOptions {
  /** Replace a provider already registered under `key`, including a built-in. */
  replace?: boolean;
  /**
   * Let a per-call `url` point this provider at a loopback, private,
   * link-local or metadata address. Off unless exactly `true`. It belongs to
   * the registration, never to a call.
   */
  allowPrivatePerCallUrl?: boolean;
}

/**
 * Teach `using()` about a provider this package does not ship.
 *
 * A key that is already registered — a built-in such as `openai`, or one
 * registered earlier — is refused unless `{ replace: true }` is passed.
 * Replacing a provider changes what every caller of that key gets,
 * process-wide, so it has to be asked for.
 *
 * Keys are compared case-insensitively (ASCII only, as the reference's
 * `strtolower()` and prism-py do), so `OpenAI` collides with `openai`.
 *
 * The key itself must be readable: see `isValidProviderName`. An invalid key
 * is refused whether or not `replace` is set, and never trimmed.
 *
 * @throws Error when the key is not a valid provider name, or is taken and
 *   `replace` is not set (a programming error, like PHP's
 *   InvalidArgumentException; it carries no Prism error code).
 */
export function registerProvider(key: string, factory: ProviderFactory, options: RegisterProviderOptions = {}): void {
  const allow = options.allowPrivatePerCallUrl === true;
  registerProviderWithPolicy(key, factory, options, {
    configuredUrl: () => null,
    allowPrivatePerCallUrl: () => allow,
  });
}

/**
 * `registerProvider()` with the per-call url policy given explicitly, for
 * `configureProviders()`, whose entries carry a configured url.
 *
 * @internal
 */
export function registerProviderWithPolicy(
  key: string,
  factory: ProviderFactory,
  options: RegisterProviderOptions,
  policy: PerCallUrlPolicy,
): void {
  assertRegistrable(key, options);
  providers.set(key, factory);
  policies.set(key, policy);
}

/**
 * The name and collision rules of `registerProvider()`, without registering.
 * `configureProviders()` checks every entry with this before it registers any.
 *
 * @internal
 */
export function assertRegistrable(key: string, options: RegisterProviderOptions = {}): void {
  if (!isValidProviderName(key)) {
    throw new Error(
      'That is not a valid provider name: a provider name must start with an ASCII letter or digit, contain only ASCII letters, digits, ".", "_" and "-", and be at most 64 characters long.',
    );
  }
  if (options.replace !== true && isRegistered(key)) {
    throw new Error(`The provider "${key}" is already registered. Pass { replace: true } to replace it.`);
  }
}

/**
 * A provider key: ASCII, starting with a letter or digit, at most 64
 * characters. A positive allow-list rather than a list of forbidden
 * characters, so it needs no Unicode tables and reads the same as the
 * reference's `extend()` and prism-py's `register_provider()`. A homoglyph
 * (Cyrillic U+043E for the first `o`), a full-width `openai`, a padded one or
 * one carrying an invisible codepoint is a second key that reads as the
 * built-in in a config file or a log, so it is refused, never trimmed or
 * folded.
 */
const VALID_PROVIDER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isValidProviderName(key: string): boolean {
  return VALID_PROVIDER_NAME.test(key);
}

/** @internal */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function isRegistered(key: string): boolean {
  const name = asciiLower(key);
  for (const registered of providers.keys()) {
    if (asciiLower(registered) === name) return true;
  }
  return false;
}

export function registeredProviders(): readonly string[] {
  return [...providers.keys()];
}

/**
 * A per-call `config.url` is checked before the factory runs, so before any
 * request: it may not name a loopback, private, link-local or metadata
 * address unless it is the configured endpoint itself or the provider's
 * CONFIGURATION opts out (see `assertPerCallUrl`).
 *
 * @throws PrismError code `unsupported_provider_action` for an unregistered key.
 * @throws PrismUrlRefused `private_address_refused` / `scheme_not_allowed` for
 *   a per-call url that is refused.
 */
export function resolveProvider(key: string, config: Record<string, unknown> = {}): Provider {
  const factory = providers.get(key);

  if (factory === undefined) {
    throw PrismError.unsupportedProviderAction(
      `The provider "${key}"`,
      `this build (registered: ${registeredProviders().join(', ')})`,
    );
  }

  // Before the factory runs, so a custom provider is held to the same rule.
  assertCleanUrl(config.url);
  assertPerCallUrlAllowed(policies.get(key), config.url);

  return factory(config);
}

function assertPerCallUrlAllowed(policy: PerCallUrlPolicy | undefined, url: unknown): void {
  // Absent or not a string: left to the provider's own type checks.
  if (typeof url !== 'string') return;

  // Every registered key has a policy; a missing one is held to the strictest.
  policy?.assertUrl?.(url);

  const configured = policy?.configuredUrl() ?? null;
  if (configured !== null && sameEndpoint(url, configured)) return;

  // The opt-out allows a private ADDRESS only. The scheme and host rules still
  // apply: a factory or transport gets the url as given (G-382).
  assertPerCallUrl(url, { allowPrivate: policy?.allowPrivatePerCallUrl() === true });
}
