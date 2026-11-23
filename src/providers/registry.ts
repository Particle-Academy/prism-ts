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
 * @throws Error when the key is taken and `replace` is not set (a programming
 *   error, like PHP's InvalidArgumentException; it carries no Prism error code).
 */
export function registerProvider(key: string, factory: ProviderFactory, options: RegisterProviderOptions = {}): void {
  if (providers.has(key) && options.replace !== true) {
    throw new Error(`The provider "${key}" is already registered. Pass { replace: true } to replace it.`);
  }
  providers.set(key, factory);
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
