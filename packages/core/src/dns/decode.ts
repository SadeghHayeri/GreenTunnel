import type dnsPacket from 'dns-packet';
import type { DnsRecord } from '../types.js';
import { familyOf, type QueryType } from './resolver.js';

/**
 * Pull the address records out of a decoded DNS response.
 *
 * The two explicit literal comparisons are what narrow `Answer` (a union of
 * ~18 record shapes) down to the string-valued one — comparing against the
 * `type` variable alone does not discriminate the union.
 */
export function extractAddresses(packet: dnsPacket.Packet, type: QueryType): DnsRecord[] {
  const family = familyOf(type);
  const records: DnsRecord[] = [];

  for (const answer of packet.answers ?? []) {
    if (answer.type !== 'A' && answer.type !== 'AAAA') continue;
    // CNAMEs in the chain are skipped: the upstream resolver already followed
    // them and returned the addresses they point at.
    if (answer.type !== type) continue;
    records.push({ address: answer.data, family, ttl: answer.ttl ?? 0 });
  }

  return records;
}
