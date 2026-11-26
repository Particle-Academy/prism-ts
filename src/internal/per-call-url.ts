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
 *
 * The host must be ASCII. IDNA converters disagree on which name some
 * characters spell (deviation characters, joiners, characters that map to
 * one), so no conversion is trusted: an international name is given in its
 * punycode (`xn--`) form, which every client sends unchanged, and a non-ASCII
 * host is refused with `non_ascii_host_use_punycode`. A format, invisible or
 * deviation character anywhere in the authority is refused first, as
 * `private_address_refused`.
 */

const PRIVATE_MESSAGE =
  'A per-call provider url may not point at a loopback, private, link-local or metadata address. Allow it in the provider config with allowPrivatePerCallUrl.';
const SCHEME_MESSAGE = 'A per-call provider url must be an absolute http or https url.';
const HOST_MESSAGE =
  'A per-call provider url host may hold only letters, digits, hyphens and dots, or an IPv6 address in brackets.';
const PUNYCODE_MESSAGE =
  'A per-call provider url host must be ASCII. Give an international name in its punycode (xn--) form.';

/** As written: a name (non-ASCII is refused after the invisible check), or a bracketed IPv6 literal. */
const WRITTEN_HOST = /^(?:[A-Za-z0-9.\-\u0080-\u{10FFFF}]+|\[[A-Za-z0-9.:-]+\])$/u;
/** After lowercasing and trailing dots: ASCII only. */
const CANONICAL_HOST = /^[a-z0-9.:-]+$/;

const MAX_IPV4 = 4294967295;

/**
 * Names that reach a non-public address without DNS: RFC 6761's `localhost`,
 * the names the stock hosts files map to loopback or to an IPv6 local or
 * multicast address, and the documented cloud metadata names. Hosts files:
 * Debian, Ubuntu and Docker (`ip6-*`); RHEL, CentOS, Fedora and Amazon Linux
 * (`localhost4`, `localhost6` and their `.localdomainN` forms); openSUSE
 * (`ipv6-*`); Alpine (`localhost.localdomain`); macOS (`broadcasthost`).
 * Windows ships no active entries.
 */
const LOCAL_NAMES = new Set([
  'localhost', 'localhost.localdomain',
  'localhost4', 'localhost4.localdomain4', 'localhost6', 'localhost6.localdomain6',
  'ip6-localhost', 'ip6-loopback', 'ip6-localnet', 'ip6-mcastprefix', 'ip6-allnodes', 'ip6-allrouters',
  'ipv6-localhost', 'ipv6-loopback', 'ipv6-localnet', 'ipv6-mcastprefix', 'ipv6-allnodes', 'ipv6-allrouters',
  'ipv6-allhosts', 'broadcasthost',
  'metadata', 'metadata.google.internal', 'instance-data',
]);

/** Every name under these reaches loopback without DNS (`*.localhost.localdomain` is nss-myhostname's). */
const LOCAL_SUFFIXES = ['.localhost', '.localhost.localdomain'];

/**
 * Refused anywhere in the authority, userinfo included: every format or
 * invisible character (Unicode's default-ignorable code points, the Cf format
 * controls, the C1 controls and the non-ASCII spaces), the four UTS46
 * deviation characters (U+00DF, U+03C2, U+200C, U+200D) and U+1E9E, which
 * UTS46 maps to U+00DF. IDNA implementations disagree on these: an HTTP client that deletes a
 * zero-width joiner contacts `localhost` where a nontransitional conversion
 * reads a public name. Spelled code point for code point in the reference
 * (`PerCallUrl::INVISIBLE`) and prism-py (`_INVISIBLE`).
 */
const INVISIBLE =
  // eslint-disable-next-line no-misleading-character-class -- a set of single code points, combining marks included on purpose
  /[\u0080-\u00A0\u00AD\u00DF\u034F\u03C2\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u115F-\u1160\u1680\u17B4-\u17B5\u1806\u180B-\u180F\u1E9E\u2000-\u200F\u2028-\u202F\u205F-\u206F\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB\u{110BD}\u{110CD}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/u;

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

/** The authority as written: from after `//` to the first `/`, `?` or `#`. */
function writtenAuthority(url: string): string {
  const rest = url.slice(url.indexOf('//') + 2);
  const cut = rest.search(/[/?#]/);
  return cut === -1 ? rest : rest.slice(0, cut);
}

/**
 * The host exactly as written. The host follows the authority's last `@` and
 * ends at the port's `:` (or, when bracketed, at the first `]`). Null when the
 * authority holds a backslash. Nothing is decoded.
 */
function writtenHost(url: string): string | null {
  const authority = writtenAuthority(url);
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
 *   address or name, or a numeric host that cannot be read safely;
 *   `non_ascii_host_use_punycode` for a host that is not ASCII.
 *
 * `allowPrivate` is the provider config's opt-out (`allowPrivatePerCallUrl`).
 * It skips only the address and local-name rules (steps 5 to 7). The scheme,
 * the host as written, the invisible characters and the ASCII rule hold
 * either way: the opt-out lets a call name a private address, never another
 * scheme or a host a client would read differently from this check.
 */
export function assertPerCallUrl(url: string, options: { allowPrivate?: boolean } = {}): void {
  // 1. A literal http:// or https:// prefix, case-insensitively.
  if (!/^https?:\/\//i.test(url)) throw schemeRefusal();

  // 2. The host as written, before any parser decodes it.
  const written = writtenHost(url);
  if (written === '') throw schemeRefusal();
  if (written === null || !WRITTEN_HOST.test(written)) throw hostRefusal();
  // An address literal has no trailing dot; only a name does.
  if (written.endsWith('.]')) throw hostRefusal();
  // A lone surrogate cannot be read as text, so it is refused as well.
  const authority = writtenAuthority(url);
  if (INVISIBLE.test(authority) || /[\uD800-\uDFFF]/u.test(authority)) throw hostRefusal();
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(written)) {
    throw new PrismUrlRefused('non_ascii_host_use_punycode', PUNYCODE_MESSAGE);
  }

  // 3. The parser's host, so userinfo (`http://evil@127.0.0.1`) is ignored.
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw schemeRefusal();
  }
  if (hostname === '') throw schemeRefusal();

  // 4. One pair of brackets off; the written host was ASCII, so anything
  // non-ASCII here is a parser surprise and refused. ASCII-lowercase, then
  // every trailing dot off.
  let host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(host)) throw privateRefusal();
  host = host.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  let end = host.length;
  while (end > 0 && host.charCodeAt(end - 1) === 46) end -= 1;
  host = host.slice(0, end);
  if (host === '') throw schemeRefusal();
  if (!CANONICAL_HOST.test(host)) throw hostRefusal();
  if (options.allowPrivate === true) return;

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
  if (LOCAL_NAMES.has(host) || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) throw privateRefusal();

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
