import { PrismError } from '../errors.js';
import { assertCleanUrl } from '../internal/provider-config.js';
import type { Provider } from './provider.js';
import { Anthropic } from './anthropic/anthropic.js';
import type { AnthropicConfig } from './anthropic/anthropic.js';
import { Mistral } from './mistral/mistral.js';
import type { MistralConfig } from './mistral/mistral.js';
import { OpenAI } from './openai/openai.js';
import type { OpenAIConfig } from './openai/openai.js';

export type ProviderFactory = (config: Record<string, unknown>) => Provider;

const providers = new Map<string, ProviderFactory>([
  ['anthropic', (config) => new Anthropic(config as AnthropicConfig)],
  ['mistral', (config) => new Mistral(config as MistralConfig)],
  ['openai', (config) => new OpenAI(config as OpenAIConfig)],
]);

export interface RegisterProviderOptions {
  /** Replace a provider already registered under `key`, including a built-in. */
  replace?: boolean;
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
  if (!isValidProviderName(key)) {
    throw new Error(
      'That is not a valid provider name: a provider name must start with an ASCII letter or digit, contain only ASCII letters, digits, ".", "_" and "-", and be at most 64 characters long.',
    );
  }
  if (options.replace !== true && isRegistered(key)) {
    throw new Error(`The provider "${key}" is already registered. Pass { replace: true } to replace it.`);
  }
  providers.set(key, factory);
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

function asciiLower(value: string): string {
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
 * @throws PrismError code `unsupported_provider_action` for an unregistered key.
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

  return factory(config);
}
