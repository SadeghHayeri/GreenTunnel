import type { DnsResolver } from '../dns/index.js';
import type { Logger } from '../logger.js';
import type { ProxySettings, TunnelInfo } from '../types.js';

/** Everything a single connection needs, injected rather than reached for. */
export interface TunnelContext {
  readonly settings: ProxySettings;
  readonly dns: DnsResolver;
  readonly logger: Logger;
  /** Aborted when the proxy shuts down. */
  readonly signal: AbortSignal;
  readonly nextTunnelId: () => number;
  /** Called once the upstream target is known and the tunnel is live. */
  readonly onOpen: (info: TunnelInfo) => void;
}
