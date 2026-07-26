/**
 * `@green-tunnel/core` — the engine.
 *
 * ```ts
 * import { Proxy, SystemProxy, DEFAULT_BYPASS } from '@green-tunnel/core';
 *
 * const proxy = new Proxy({ port: 8000, dns: { mode: 'doh' } });
 * const { host, port } = await proxy.start();
 *
 * const system = new SystemProxy();
 * await system.enable({ host, port, bypass: DEFAULT_BYPASS });
 * ```
 */

export { Proxy, type ProxyDependencies } from './proxy/index.js';

export {
  DEFAULT_DNS,
  DEFAULT_FRAGMENT,
  DEFAULT_SETTINGS,
  assertValidSettings,
  resolveSettings,
} from './config.js';

export {
  ConnectError,
  DnsError,
  GreenTunnelError,
  ProtocolError,
  SystemProxyError,
  toError,
} from './errors.js';

export {
  LOG_LEVELS,
  Logger,
  createLogger,
  isLogLevel,
  stderrSink,
  type LogLevel,
  type LogRecord,
  type LogSink,
  type LoggerOptions,
} from './logger.js';

export {
  CachingDnsResolver,
  DohResolver,
  DotResolver,
  PlainResolver,
  createDnsResolver,
  type DnsResolver,
  type QueryType,
} from './dns/index.js';

export {
  DEFAULT_BYPASS,
  SystemProxy,
  createSystemProxyDriver,
  defaultRecoveryPath,
  isSystemProxySupported,
  recoverSystemProxy,
  type SystemProxyDriver,
  type SystemProxyOptions,
} from './system-proxy/index.js';

export { fragmentClientHello, isClientHello, splitBytes } from './tls/fragment.js';

export { HttpRequestRewriter, createRequestRewriteStream } from './http/rewriter.js';

export {
  getHeader,
  parseRequestHead,
  resolveUpstream,
  serializeRequestHead,
  splitAuthority,
  toOriginForm,
  type HeaderField,
  type RequestHead,
} from './http/head.js';

export type {
  DeepPartial,
  DnsMode,
  DnsRecord,
  DnsSettings,
  FragmentSettings,
  IpFamilyPreference,
  ProxyAddress,
  ProxyEndpointState,
  ProxyEventMap,
  ProxyOptions,
  ProxySettings,
  ProxyStats,
  SystemProxySettings,
  SystemProxySnapshot,
  SystemProxySnapshotEntry,
  TunnelInfo,
  TunnelKind,
} from './types.js';
