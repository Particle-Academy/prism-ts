import { isIP } from 'node:net';
import { PrismUrlRefused } from '../errors.js';
import { isPublicAddress } from './public-url.js';

/**
 * A provider url passed with ONE call (`using(provider, model, { url })`) may
 * not choose a loopback, private, link-local or metadata address. Configured
 * urls (environment, provider default, a compatible entry) are not checked
 * here; they may point anywhere. Spelled step for step like the reference's
 * `PerCallUrl::assert()` and prism-py's `assert_per_call_url()`.
 *
 * Synchronous and offline: no DNS. A hostname that RESOLVES to a private
 * address is not caught; only an address literal (in the forms a resolver
 * reads) or a well-known local / metadata name is. The messages never name
 * the url, the host or the address.
 *
 * The host is judged AS WRITTEN, before WHATWG URL decodes it, because the
 * other two languages' clients do not decode it and one rule must hold in
 * all three. A host holding anything but letters, digits, `-` and `.` (and,
 * inside brackets, an IPv6 literal's `:`) is refused, `%` included, and so is
 * a backslash anywhere in the authority, which URL parsers split in different
 * places. Never decoded and re-checked.
 */

const PRIVATE_MESSAGE =
  'A per-call provider url may not point at a loopback, private, link-local or metadata address. Allow it in the provider config with allowPrivatePerCallUrl.';
const SCHEME_MESSAGE = 'A per-call provider url must be an absolute http or https url.';
const HOST_MESSAGE =
  'A per-call provider url host may hold only letters, digits, hyphens and dots, or an IPv6 address in brackets.';

/** As written: a name (non-ASCII is left to IDNA), or a bracketed IPv6 literal. */
const WRITTEN_HOST = /^(?:[A-Za-z0-9.\-\u0080-\u{10FFFF}]+|\[[A-Za-z0-9.:-]+\])$/u;
/** After IDNA, lowercasing and trailing dots: ASCII only. */
const CANONICAL_HOST = /^[a-z0-9.:-]+$/;

const MAX_IPV4 = 4294967295;

const LOCAL_NAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata', 'metadata.google.internal', 'instance-data',
]);

function privateRefusal(): PrismUrlRefused {
  return new PrismUrlRefused('private_address_refused', PRIVATE_MESSAGE);
}

function schemeRefusal(): PrismUrlRefused {
  return new PrismUrlRefused('scheme_not_allowed', SCHEME_MESSAGE);
}

/** The private-address code: a host that cannot be read safely is refused under the rule it might evade. */
function hostRefusal(): PrismUrlRefused {
  return new PrismUrlRefused('private_address_refused', HOST_MESSAGE);
}

/**
 * The host exactly as written. The authority runs from after `//` to the
 * first `/`, `?` or `#`; the host follows its last `@` and ends at the port's
 * `:` (or, when bracketed, at the first `]`). Null when the authority holds a
 * backslash. Nothing is decoded.
 */
function writtenHost(url: string): string | null {
  const rest = url.slice(url.indexOf('//') + 2);
  const cut = rest.search(/[/?#]/);
  const authority = cut === -1 ? rest : rest.slice(0, cut);
  if (authority.includes('\\')) return null;
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']');
    return end === -1 ? hostPort : hostPort.slice(0, end + 1);
  }
  const colon = hostPort.indexOf(':');
  return colon === -1 ? hostPort : hostPort.slice(0, colon);
}

/**
 * @throws PrismUrlRefused `scheme_not_allowed` for anything that is not an
 *   absolute http(s) url with a host; `private_address_refused` for a refused
 *   address or name, or a numeric host that cannot be read safely.
 */
export function assertPerCallUrl(url: string): void {
  // 1. A literal http:// or https:// prefix, case-insensitively.
  if (!/^https?:\/\//i.test(url)) throw schemeRefusal();

  // 2. The host as written, before any parser decodes it.
  const written = writtenHost(url);
  if (written === '') throw schemeRefusal();
  if (written === null || !WRITTEN_HOST.test(written)) throw hostRefusal();

  // 3. The parser's host, so userinfo (`http://evil@127.0.0.1`) is ignored.
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw schemeRefusal();
  }
  if (hostname === '') throw schemeRefusal();

  // 4. One pair of brackets off; WHATWG URL already gives ASCII (punycode),
  // so anything non-ASCII is a parser surprise and refused. ASCII-lowercase,
  // then every trailing dot off.
  let host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(host)) throw privateRefusal();
  host = host.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  let end = host.length;
  while (end > 0 && host.charCodeAt(end - 1) === 46) end -= 1;
  host = host.slice(0, end);
  if (host === '') throw schemeRefusal();
  if (!CANONICAL_HOST.test(host)) throw hostRefusal();

  // 5. An IPv6 literal.
  if (host.includes(':')) {
    if (host.includes('%') || isIP(host) !== 6 || !isPublicAddress(host)) throw privateRefusal();
    return;
  }

  // 6. IPv4 in every form a resolver accepts.
  const labels = host.split('.');
  if (/^(0x[0-9a-f]*|[0-9]+)$/i.test(labels[labels.length - 1] ?? '')) {
    if (!isPublicAddress(ipv4Address(labels))) throw privateRefusal();
    return;
  }

  // 7. Well-known local and metadata names.
  if (LOCAL_NAMES.has(host) || host.endsWith('.localhost')) throw privateRefusal();

  // 8. Any other name is allowed; resolving it would need the network.
}

/** The dotted quad an IPv4 attempt names, or a refusal when it cannot be read. */
function ipv4Address(labels: readonly string[]): string {
  if (labels.length > 4) throw privateRefusal();

  const values = labels.map(labelValue);
  const last = values.length - 1;
  let value = 0;
  for (let i = 0; i < last; i += 1) {
    const label = values[i] as number;
    if (label > 255) throw privateRefusal();
    value += label * 256 ** (3 - i);
  }
  const tail = values[last] as number;
  if (tail > 256 ** (5 - values.length) - 1) throw privateRefusal();
  value += tail;

  return [value / 16777216, value / 65536, value / 256, value].map((part) => Math.floor(part) % 256).join('.');
}

/** One label, digit by digit; never a float, never past 4294967295. */
function labelValue(label: string): number {
  let digits: string;
  let base: number;
  if (/^0x[0-9a-f]*$/i.test(label)) {
    digits = label.slice(2);
    base = 16;
  } else if (/^0[0-7]+$/.test(label)) {
    digits = label.slice(1);
    base = 8;
  } else if (/^(0|[1-9][0-9]*)$/.test(label)) {
    digits = label;
    base = 10;
  } else {
    throw privateRefusal();
  }

  let value = 0;
  for (const digit of digits) {
    value = value * base + parseInt(digit, 16);
    if (value > MAX_IPV4) throw privateRefusal();
  }

  return value;
}
