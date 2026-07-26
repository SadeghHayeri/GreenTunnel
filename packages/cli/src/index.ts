/**
 * Library surface of the `green-tunnel` package.
 *
 * v2 published the engine under this name and v3 does again, so `import { Proxy }
 * from 'green-tunnel'` has never stopped working. The engine lives in `./core`,
 * which was briefly a separate `@green-tunnel/core` package and is not published
 * on its own — one package, one version, no scope to own.
 */
export * from './core/index.js';
export { VERSION } from './version.js';
