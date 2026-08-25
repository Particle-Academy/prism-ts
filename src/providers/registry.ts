import { PrismError } from '../errors.js';
import type { Provider } from './provider.js';
import { OpenAI } from './openai/openai.js';
import type { OpenAIConfig } from './openai/openai.js';

export type ProviderFactory = (config: Record<string, unknown>) => Provider;

const providers = new Map<string, ProviderFactory>([
  ['openai', (config) => new OpenAI(config as OpenAIConfig)],
]);

/** Teach `using()` about a provider this package does not ship. */
export function registerProvider(key: string, factory: ProviderFactory): void {
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
