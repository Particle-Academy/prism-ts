import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { PrismUrlRefused } from '../errors.js';

/** Override resolution for a service mesh or tests; every address is checked. */
export interface HostResolver {
  resolve(host: string): readonly string[] | Promise<readonly string[]>;
}

export const dnsHostResolver: HostResolver = {
  async resolve(host) {
    try {
      return (await lookup(host, { all: true, verbatim: true })).map(record => record.address);
    } catch {
      return [];
    }
  },
};

// Every range a guarded fetch refuses, spelled identically in all three
// languages rather than delegated to a language's IP helpers (G-89): PHP's
// filter_var flags missed CGNAT, where Alibaba Cloud's metadata endpoint lives.
// All IPv4-compatible IPv6 spellings are refused consistently.
// Keep lists separate: Node maps IPv4 into IPv6 for BlockList comparisons, so
// blocking mapped IPv6 in a shared list would also block public IPv4.
const ipv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) ipv4.addSubnet(address, prefix, 'ipv4');
const ipv6 = new BlockList();
for (const [address, prefix] of [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 32], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8],
] as const) ipv6.addSubnet(address, prefix, 'ipv6');

// NAT64 and 6to4 carry an IPv4 address inside an IPv6 one, and the embedded
// address is where the packet goes: 64:ff9b::a9fe:a9fe IS the metadata endpoint
// on a NAT64 network. The embedded address is judged. Not refused outright,
// because a DNS64 resolver hands an IPv6-only host 64:ff9b:: addresses for
// perfectly public sites. [prefix, bits, byte offset of the embedded IPv4]
const EMBEDDING: readonly (readonly [string, number, number])[] = [
  ['64:ff9b::', 96, 12],
  ['2002::', 16, 2],
];

function assertPublicAddress(address: string): void {
  const family = isIP(address);
  if (family === 6 && !address.includes('%')) {
    for (const [prefix, bits, offset] of EMBEDDING) {
      const range = new BlockList();
      range.addSubnet(prefix, bits, 'ipv6');
      if (range.check(address, 'ipv6')) {
        assertPublicAddress(ipv6Bytes(address).slice(offset, offset + 4).join('.'));
        return;
      }
    }
  }
  if (address.includes('%') || family === 0 ||
    (family === 4 ? ipv4.check(address, 'ipv4') : ipv6.check(address, 'ipv6'))) {
    throw new PrismUrlRefused('private_address_refused', 'A guarded fetch refuses private, reserved or invalid addresses.');
  }
}

/** The sixteen bytes of a valid IPv6 address, including a dotted IPv4 tail. */
function ipv6Bytes(address: string): number[] {
  let text = address;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted !== null) {
    const [a, b, c, d] = dotted[1]!.split('.').map(Number) as [number, number, number, number];
    text = text.slice(0, -dotted[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return groups.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

/** Validate the literal and every DNS answer before the caller sends HTTP.
 * Resolution is not connection pinning: DNS rebinding remains possible.
 */
export async function assertPublicUrl(url: string, resolver: HostResolver): Promise<void> {
  let parsed: URL;
  try {
    if (!/^https?:\/\//i.test(url)) throw new Error('Not an absolute HTTP URL');
    parsed = new URL(url);
  } catch {
    throw new PrismUrlRefused('scheme_not_allowed', 'A guarded fetch needs an absolute http or https URL.');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) {
    assertPublicAddress(host);
    return;
  }
  const addresses = await resolver.resolve(host);
  if (addresses.length === 0) {
    throw new PrismUrlRefused('host_did_not_resolve', 'The hostname did not resolve to a verifiable public address.');
  }
  for (const address of addresses) assertPublicAddress(address);
}
