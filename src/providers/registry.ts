import { PrismError } from '../errors.js';
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
      'That is not a valid provider name: a provider name must be non-empty and contain no whitespace, control, format or invisible characters.',
    );
  }
  if (options.replace !== true && isRegistered(key)) {
    throw new Error(`The provider "${key}" is already registered. Pass { replace: true } to replace it.`);
  }
  providers.set(key, factory);
}

/**
 * A provider key may not be empty, and may not contain a control (Cc), format
 * (Cf) or lone-surrogate (Cs) codepoint, nor any codepoint of the G-36 set:
 * U+0000, U+0009..U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000..U+200D,
 * U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. That set is spelled by
 * codepoint, identically to the human-plus confirmation guard and to the
 * reference and prism-py, because each language's own idea of whitespace
 * (`.trim()`, `\s`) disagrees with the others'. ` openai`, `openai ` and
 * `openai` + U+200B are distinct keys that read as the built-in in a config
 * file or a log, so they are refused rather than trimmed into another name.
 */
const VALID_PROVIDER_NAME =
  // Matching control characters is the point: they are what this refuses.
  // eslint-disable-next-line no-control-regex
  /^[^\p{Cc}\p{Cf}\p{Cs}\u0000\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]+$/u;

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

  return factory(config);
}
