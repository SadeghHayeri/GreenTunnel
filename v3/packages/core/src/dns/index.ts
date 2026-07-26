import type { DnsSettings } from '../types.js';
import { createDohResolver } from './doh.js';
import { createDotResolver } from './dot.js';
import { createPlainResolver } from './plain.js';
import type { DnsResolver } from './resolver.js';

export { CachingDnsResolver, type DnsResolver, type QueryType } from './resolver.js';
export { DohResolver } from './doh.js';
export { DotResolver } from './dot.js';
export { PlainResolver } from './plain.js';

export function createDnsResolver(settings: DnsSettings): DnsResolver {
  switch (settings.mode) {
    case 'doh':
      return createDohResolver(settings);
    case 'dot':
      return createDotResolver(settings);
    case 'plain':
      return createPlainResolver(settings);
  }
}
