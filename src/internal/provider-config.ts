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

export function configuredString(value: unknown, name: string, fallback: string, nullFallback?: string): string {
  const resolved = value === undefined ? environmentValue(name, fallback) : value;
  if (resolved === null && nullFallback !== undefined) return nullFallback;
  if (typeof resolved !== 'string') throw new TypeError(`Invalid string configuration for ${name}.`);
  return resolved;
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
