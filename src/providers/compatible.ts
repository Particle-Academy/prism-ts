import { assertCleanUrl, sameEndpoint } from '../internal/provider-config.js';
import { isJsonObject } from '../json.js';
import { asciiLower, assertRegistrable, registerProviderWithPolicy } from './registry.js';
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
  /**
   * An absolute http or https url, e.g. `http://10.0.0.5:8000/v1`. This is
   * CONFIGURATION, so private addresses are allowed here. A per-call `url`
   * passed to `using()` is not: it is refused for a loopback, private,
   * link-local or metadata address unless `allowPrivatePerCallUrl` is set.
   */
  url: string;
  apiKey?: string | null;
  /** `'chat_completions'` (the default) or `'responses'`. */
  apiFormat?: string | null;
  organization?: string | null;
  project?: string | null;
  /**
   * Let a per-call `url` point this entry at a loopback, private, link-local
   * or metadata address. Off unless exactly `true`; a per-call
   * `allowPrivatePerCallUrl` is never read.
   */
  allowPrivatePerCallUrl?: boolean | null;
}

/** Only `replace`: the per-call url opt-out is set per entry. */
export type ConfigureProvidersOptions = Pick<RegisterProviderOptions, 'replace'>;

const DRIVER = 'openai-compatible';
const API_FORMATS = ['chat_completions', 'responses'];
const ENTRY_KEYS = new Set(['driver', 'url', 'apiKey', 'apiFormat', 'organization', 'project', 'allowPrivatePerCallUrl']);
type CredentialKey = 'apiKey' | 'organization' | 'project';

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
 * organization and project; the per-call config must bring its own. It is
 * also refused, before any request, when it names a loopback, private,
 * link-local or metadata address, unless the entry sets
 * `allowPrivatePerCallUrl: true`.
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

  const registration = { replace: options.replace === true };
  for (const [name, entry] of validated) {
    registerProviderWithPolicy(name, (config) => new OpenAI(compatibleConfig(entry, config)), registration, {
      configuredUrl: () => entry.url,
      allowPrivatePerCallUrl: () => entry.allowPrivatePerCallUrl,
      assertUrl: assertCompatibleUrl,
    });
  }
}

interface ValidEntry {
  url: string;
  apiKey: string | null;
  apiFormat: string;
  organization: string | null;
  project: string | null;
  allowPrivatePerCallUrl: boolean;
}

function validateEntry(entry: unknown): ValidEntry {
  if (!isJsonObject(entry)) {
    throw new TypeError('That is not a valid provider entry: each entry must be an object.');
  }

  if (Object.keys(entry).some((key) => !ENTRY_KEYS.has(key))) {
    throw new TypeError(
      'That is not a valid provider entry: the settings are driver, url, apiKey, apiFormat, organization, project and allowPrivatePerCallUrl.',
    );
  }

  // Every field is read ONCE, so the value checked is the value kept: an
  // accessor cannot hand the check one url and the provider another.
  const { driver, url, apiKey, apiFormat, organization, project, allowPrivatePerCallUrl } = entry;

  if (driver !== DRIVER) {
    throw new TypeError('That is not a supported provider driver: a configured provider must use the "openai-compatible" driver.');
  }

  assertCompatibleUrl(url);

  return {
    url,
    apiKey: credentialValue(apiKey),
    apiFormat: apiFormatValue(apiFormat) ?? 'chat_completions',
    organization: credentialValue(organization),
    project: credentialValue(project),
    allowPrivatePerCallUrl: optOutValue(allowPrivatePerCallUrl),
  };
}

/** Only boolean `true` opts out; absent, null and false do not; anything else is refused. */
function optOutValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') {
    throw new TypeError('That is not a valid provider entry: allowPrivatePerCallUrl must be a boolean or null.');
  }

  return value;
}

function credentialValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new TypeError('That is not a valid provider entry: apiKey, organization and project must be strings or null.');
  }

  return value;
}

/** null for "not given"; anything given must be one of the two formats. */
function apiFormatValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !API_FORMATS.includes(value)) {
    throw new TypeError('That is not a valid api format: use "chat_completions" or "responses".');
  }

  return value;
}

/**
 * An absolute http or https url with a host, and nothing a lenient parser
 * would quietly repair: no whitespace or control characters anywhere (the
 * shared clean-url rule), and a literal `http://` or `https://` prefix, so
 * `http:host` or `http:\\host` cannot be read as a url by one language and
 * refused by another.
 *
 * Private, loopback and link-local hosts pass THIS check: an entry url is
 * operator configuration, and the guarded property is that no other
 * credential goes there. A per-call url is additionally held to
 * `assertPerCallUrl()` by `resolveProvider()`, after this check.
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
  const perCallUrl = perCall.url;

  if (perCallUrl !== undefined) {
    assertCompatibleUrl(perCallUrl);
    url = perCallUrl;
    inherit = url === entry.url || sameEndpoint(url, entry.url);
  }

  const credential = (key: CredentialKey): string | null => {
    const value = perCall[key];

    return value !== undefined ? credentialValue(value) : inherit ? entry[key] : null;
  };

  const apiFormat = apiFormatValue(perCall.apiFormat) ?? entry.apiFormat;

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
