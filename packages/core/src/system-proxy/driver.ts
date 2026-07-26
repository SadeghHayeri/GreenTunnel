import type { SystemProxySettings, SystemProxySnapshot } from '../types.js';

/** One implementation per OS. */
export interface SystemProxyDriver {
  readonly platform: NodeJS.Platform;
  /** Capture the current OS proxy configuration so it can be put back. */
  snapshot(): Promise<SystemProxySnapshot>;
  /**
   * Point the OS at our proxy, touching **exactly** the targets in `snapshot`.
   *
   * Taking the target list from the snapshot rather than re-enumerating is the
   * whole point of this signature. v3.0's macOS driver called
   * `listAllNetworkServices()` separately in `snapshot()` and `apply()`, so any
   * service that appeared in between — a USB-C ethernet dongle, an iPhone
   * tether, a VPN connecting — was proxied with no snapshot entry to restore it
   * from, and stayed pointed at a dead port permanently.
   */
  apply(settings: SystemProxySettings, snapshot: SystemProxySnapshot): Promise<void>;
  /** Put back exactly what `snapshot()` recorded, for every entry it holds. */
  restore(snapshot: SystemProxySnapshot): Promise<void>;
}
