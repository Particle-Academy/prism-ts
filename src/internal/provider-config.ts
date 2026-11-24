/** Configuration presence is distinct from its value, including empty strings. */
export function readEnvironment(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

/** Laravel's env() scalar spellings; direct configuration stays literal. */
function environmentValue(name: string, fallback: unknown): unknown {
  const value = readEnvironment(name);
  if (value === undefined) return fallback;
  switch (value.toLowerCase()) {
    case 'null': case '(null)': return null;
    case 'true': case '(true)': return true;
    case 'false': case '(false)': return false;
    case 'empty': case '(empty)': return '';
  }
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

/**
 * An opt-in flag from the environment: ON only when Laravel's env() reading
 * of the value is boolean true (`true` / `(true)`, case-insensitively).
 * `1`, `yes` and every other text are off.
 */
export function environmentFlag(name: string): boolean {
  return environmentValue(name, false) === true;
}

/**
 * The url the environment configures (or the default), or null when the
 * environment value is unusable: an unusable value configures no endpoint.
 */
export function environmentUrl(name: string, fallback: string, nullFallback?: string): string | null {
  try {
    return configuredString(undefined, name, fallback, nullFallback);
  } catch {
    return null;
  }
}

export function configuredString(value: unknown, name: string, fallback: string, nullFallback?: string): string {
  const resolved = value === undefined ? environmentValue(name, fallback) : value;
  if (resolved === null && nullFallback !== undefined) return nullFallback;
  if (typeof resolved !== 'string') throw new TypeError(`Invalid string configuration for ${name}.`);
  return resolved;
}

/**
 * Codepoints a provider url may not contain anywhere, spelled by codepoint and
 * identically in the reference and prism-py: every Cc control (U+0000..U+001F,
 * U+007F..U+009F), every Unicode White_Space codepoint, and the G-36
 * zero-widths U+200B..U+200D and U+FEFF. Each language's own idea of
 * whitespace (`.trim()`, `\s`) disagrees with the others', so none is used.
 */
const URL_FORBIDDEN =
  // Matching control characters is the point: they are what this refuses.
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u0020\u007F-\u009F\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]/;

/**
 * Refuse a url that carries whitespace or a control character anywhere,
 * including at either end. It is never trimmed: where the key goes must not
 * depend on how tolerant an HTTP stack is of a padded url. The message names
 * neither the url nor any credential. Anything that is not a string is left
 * to the caller's own type check.
 *
 * @throws TypeError for a url containing a forbidden codepoint.
 */
export function assertCleanUrl(url: unknown): void {
  if (typeof url === 'string' && URL_FORBIDDEN.test(url)) {
    throw new TypeError('That is not a valid provider url: a provider url must not contain whitespace or control characters.');
  }
}

/**
 * The provider url, configured or per call, with both checked by
 * `assertCleanUrl()` before anything is built. A padded environment url is a
 * misconfiguration even when this call overrides it.
 */
export function configuredUrl(value: unknown, name: string, fallback: string, nullFallback?: string): string {
  assertCleanUrl(readEnvironment(name));
  assertCleanUrl(value);
  return configuredString(value, name, fallback, nullFallback);
}

/** Linear, unlike /\/+$/ which is quadratic on a long run of slashes mid-string. */
function withoutTrailingSlash(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) end -= 1;
  return path.slice(0, end);
}

/** Canonical endpoint identity: case-insensitive scheme/host, default port, no trailing slash. */
function endpointIdentity(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname === '') return null;

  return [
    parsed.protocol,
    parsed.username,
    parsed.password,
    parsed.hostname,
    parsed.port,
    withoutTrailingSlash(parsed.pathname),
    parsed.search,
  ].join('|');
}

/**
 * True when two URLs name the same endpoint. A trailing slash or a difference
 * in the case of the scheme or host does not make a different endpoint; a
 * different scheme, host, port, path or query does. Unparseable is never same.
 */
export function sameEndpoint(a: string, b: string): boolean {
  const left = endpointIdentity(a);
  return left !== null && left === endpointIdentity(b);
}

/**
 * Credentials from the environment are scoped to the endpoint the environment
 * configures (or the provider default). `inherit` is false when the caller
 * pointed the provider at a different URL; the environment value is then not
 * read, and the caller must pass the credential explicitly.
 */
export function scopedString(value: unknown, name: string, inherit: boolean, fallback: string, nullFallback?: string): string {
  if (value === undefined && !inherit) return fallback;
  return configuredString(value, name, fallback, nullFallback);
}

export function scopedNullableString(value: unknown, name: string, inherit: boolean): string | null {
  if (value === undefined && !inherit) return null;
  return nullableString(value, name);
}

/**
 * Whether environment credentials apply to `url`: only when it is the URL the
 * environment configures, or the provider default when none is configured.
 */
export function inheritsEnvironmentCredentials(url: string, urlName: string, fallback: string, nullFallback?: string): boolean {
  let configuredUrl: string;
  try {
    configuredUrl = configuredString(undefined, urlName, fallback, nullFallback);
  } catch {
    // An unusable environment URL configures no endpoint to scope a key to.
    return false;
  }
  return url === configuredUrl || sameEndpoint(url, configuredUrl);
}

export function nullableString(value: unknown, name: string): string | null {
  const resolved = value === undefined ? environmentValue(name, null) : value;
  if (resolved !== null && typeof resolved !== 'string') throw new TypeError(`Invalid nullable string configuration for ${name}.`);
  return resolved;
}

let warnedLegacyBeta = false;

export function anthropicBeta(value: unknown): string | null {
  if (value !== undefined || readEnvironment('ANTHROPIC_BETA') !== undefined) {
    return nullableString(value, 'ANTHROPIC_BETA');
  }
  const legacy = readEnvironment('ANTHROPIC_BETA_FEATURES');
  if (legacy === undefined) return null;
  if (!warnedLegacyBeta) {
    warnedLegacyBeta = true;
    (globalThis as { process?: { emitWarning?: (message: string) => void } }).process?.emitWarning?.('ANTHROPIC_BETA_FEATURES is deprecated; use ANTHROPIC_BETA.');
  }
  return legacy;
}

/** PHP casts the configured default, but accepts only an integer request budget. */
export function thinkingBudgetDefault(value: unknown): number {
  const resolved = value === undefined ? environmentValue('ANTHROPIC_DEFAULT_THINKING_BUDGET', 1024) : value;
  if (typeof resolved === 'boolean') return resolved ? 1 : 0;
  if (resolved === null) return 0;
  if (typeof resolved === 'number') return Number.isFinite(resolved) ? Math.trunc(resolved) : 0;
  if (typeof resolved === 'string') {
    const prefix = /^\s*[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(resolved)?.[0];
    return prefix === undefined ? 0 : Math.trunc(Number(prefix));
  }
  throw new TypeError('Invalid ANTHROPIC_DEFAULT_THINKING_BUDGET configuration.');
}
