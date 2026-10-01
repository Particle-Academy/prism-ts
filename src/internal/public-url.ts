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

// Private/reserved ranges, plus all IPv4-compatible IPv6 spellings. PHP's
// textual filter refuses ::127.0.0.1 but admits its compressed form ::7f00:1;
// WHATWG URL parsing normalizes the former to the latter. Refuse the entire
// compatible range consistently, including addresses PHP would admit.
// Keep lists separate: Node maps IPv4 into IPv6 for BlockList comparisons, so
// blocking mapped IPv6 in a shared list would also block public IPv4.
const ipv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['240.0.0.0', 4],
] as const) ipv4.addSubnet(address, prefix, 'ipv4');
const ipv6 = new BlockList();
for (const [address, prefix] of [
  ['::', 96], ['::ffff:0:0', 96], ['fc00::', 7], ['fe80::', 10],
] as const) ipv6.addSubnet(address, prefix, 'ipv6');

function assertPublicAddress(address: string): void {
  const family = isIP(address);
  if (address.includes('%') || family === 0 ||
    (family === 4 ? ipv4.check(address, 'ipv4') : ipv6.check(address, 'ipv6'))) {
    throw new PrismUrlRefused('private_address_refused', 'A guarded fetch refuses private, reserved or invalid addresses.');
  }
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
