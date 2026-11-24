import { assertCleanUrl, sameEndpoint } from '../internal/provider-config.js';
import { isJsonObject } from '../json.js';
import { asciiLower, assertRegistrable, registerProvider } from './registry.js';
import type { RegisterProviderOptions } from './registry.js';
import { OpenAI } from './openai/openai.js';
import type { OpenAIConfig } from './openai/openai.js';

/**
 * One named OpenAI-compatible endpoint: vLLM, LM Studio, a gateway, another
 * vendor speaking OpenAI's wire format.
 *
 * Only these credentials are ever sent there. A missing, null or empty
 * `apiKey` sends no `Authorization` header at all, whatever `OPENAI_API_KEY`
 * holds; the same goes for `organization` and `project`.
 */
export interface CompatibleProviderEntry {
  driver: 'openai-compatible';
  /** An absolute http or https url, e.g. `http://10.0.0.5:8000/v1`. Private addresses are allowed. */
  url: string;
  apiKey?: string | null;
  /** `'chat_completions'` (the default) or `'responses'`. */
  apiFormat?: string | null;
  organization?: string | null;
  project?: string | null;
}

export type ConfigureProvidersOptions = RegisterProviderOptions;

const DRIVER = 'openai-compatible';
const API_FORMATS = ['chat_completions', 'responses'];
const ENTRY_KEYS = new Set(['driver', 'url', 'apiKey', 'apiFormat', 'organization', 'project']);
const CREDENTIAL_KEYS = ['apiKey', 'organization', 'project'] as const;

/** The per-call settings a compatible provider takes from `using(name, model, config)`. */
const PER_CALL_PASSTHROUGH = ['transport', 'streamTransport', 'binaryTransport'] as const;

/**
 * Register named OpenAI-compatible providers, then reach them with
 * `using(name, model)`.
 *
 * EVERY entry is checked before ANY is registered, so a bad entry leaves the
 * registry as it was. Each then goes through `registerProvider()`, so a name
 * is held to exactly the same rules: the ASCII allow-list, never trimmed or
 * folded, and refused when it matches a built-in (`openai`, `OpenAI`,
 * `ANTHROPIC`) or an earlier registration, ASCII case-insensitively, unless
 * `{ replace: true }` is passed. Two entries in one call that differ only in
 * case are refused either way.
 *
 * A per-call `url` that names a different endpoint drops the entry's key,
 * organization and project; the per-call config must bring its own.
 *
 * No refusal message contains a url, a key or a header value.
 *
 * @throws Error / TypeError (programming errors; no Prism error code) when a
 *   name, driver, url, api format or credential is not acceptable.
 */
export function configureProviders(
  entries: Readonly<Record<string, CompatibleProviderEntry>>,
  options: ConfigureProvidersOptions = {},
): void {
  if (!isJsonObject(entries as unknown)) {
    throw new TypeError('That is not a valid provider entry: configureProviders() takes an object of named entries.');
  }

  const validated: [string, ValidEntry][] = [];
  const seen = new Set<string>();

  for (const [name, entry] of Object.entries(entries)) {
    assertRegistrable(name, options);

    if (seen.has(asciiLower(name))) {
      throw new Error(`The provider "${name}" is already registered earlier in this configuration.`);
    }
    seen.add(asciiLower(name));

    validated.push([name, validateEntry(entry)]);
  }

  for (const [name, entry] of validated) {
    registerProvider(name, (config) => new OpenAI(compatibleConfig(entry, config)), options);
  }
}

interface ValidEntry {
  url: string;
  apiKey: string | null;
  apiFormat: string;
  organization: string | null;
  project: string | null;
}

function validateEntry(entry: unknown): ValidEntry {
  if (!isJsonObject(entry)) {
    throw new TypeError('That is not a valid provider entry: each entry must be an object.');
  }

  if (Object.keys(entry).some((key) => !ENTRY_KEYS.has(key))) {
    throw new TypeError(
      'That is not a valid provider entry: the settings are driver, url, apiKey, apiFormat, organization and project.',
    );
  }

  if (entry.driver !== DRIVER) {
    throw new TypeError('That is not a supported provider driver: a configured provider must use the "openai-compatible" driver.');
  }

  assertCompatibleUrl(entry.url);

  for (const key of CREDENTIAL_KEYS) {
    const value = entry[key];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new TypeError('That is not a valid provider entry: apiKey, organization and project must be strings or null.');
    }
  }

  const apiFormat = entry.apiFormat ?? 'chat_completions';
  if (typeof apiFormat !== 'string' || !API_FORMATS.includes(apiFormat)) {
    throw new TypeError('That is not a valid api format: use "chat_completions" or "responses".');
  }

  return {
    url: entry.url as string,
    apiKey: (entry.apiKey as string | null | undefined) ?? null,
    apiFormat,
    organization: (entry.organization as string | null | undefined) ?? null,
    project: (entry.project as string | null | undefined) ?? null,
  };
}

/**
 * An absolute http or https url with a host, and nothing a lenient parser
 * would quietly repair: no whitespace or control characters anywhere (the
 * shared clean-url rule), and a literal `http://` or `https://` prefix, so
 * `http:host` or `http:\\host` cannot be read as a url by one language and
 * refused by another.
 *
 * Private, loopback and link-local hosts are ALLOWED: the url is operator
 * configuration, and the guarded property is that no other credential goes
 * there.
 */
function assertCompatibleUrl(url: unknown): asserts url is string {
  const refusal = 'That is not a valid provider url: a provider url must be an absolute http or https url with a host.';

  if (typeof url !== 'string') {
    throw new TypeError(refusal);
  }

  assertCleanUrl(url);

  if (!/^https?:\/\//i.test(url)) {
    throw new TypeError(refusal);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(refusal);
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname === '') {
    throw new TypeError(refusal);
  }
}

/**
 * The OpenAI config for one call: the entry's credentials, per-call values
 * when given, and NOTHING from the environment.
 */
function compatibleConfig(entry: ValidEntry, perCall: Record<string, unknown>): OpenAIConfig {
  let url = entry.url;
  let inherit = true;

  if (perCall.url !== undefined) {
    assertCompatibleUrl(perCall.url);
    url = perCall.url;
    inherit = url === entry.url || sameEndpoint(url, entry.url);
  }

  const credential = (key: (typeof CREDENTIAL_KEYS)[number]): string | null => {
    const value = perCall[key];
    if (value !== undefined) {
      if (value !== null && typeof value !== 'string') {
        throw new TypeError('That is not a valid provider entry: apiKey, organization and project must be strings or null.');
      }

      return value;
    }

    return inherit ? entry[key] : null;
  };

  let apiFormat = entry.apiFormat;
  if (perCall.apiFormat !== undefined && perCall.apiFormat !== null) {
    if (typeof perCall.apiFormat !== 'string' || !API_FORMATS.includes(perCall.apiFormat)) {
      throw new TypeError('That is not a valid api format: use "chat_completions" or "responses".');
    }
    apiFormat = perCall.apiFormat;
  }

  const config: OpenAIConfig = {
    ignoreEnvironment: true,
    url,
    apiKey: credential('apiKey'),
    organization: credential('organization'),
    project: credential('project'),
    apiFormat,
  };

  for (const key of PER_CALL_PASSTHROUGH) {
    if (perCall[key] !== undefined) {
      Object.assign(config, { [key]: perCall[key] });
    }
  }

  return config;
}
