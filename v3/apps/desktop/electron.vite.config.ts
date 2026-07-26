import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

const root = import.meta.dirname;

/**
 * The app declares no runtime `dependencies` on purpose: `@green-tunnel/core`
 * and everything it uses are bundled straight into `out/main/index.js`. That
 * keeps electron-builder from having to reason about workspace symlinks, and
 * the shipped app has nothing to resolve at startup beyond Node built-ins.
 */
export default defineConfig({
  main: {
    build: {
      // Only real `dependencies` are externalized — we have none.
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve(root, 'src/main/index.ts') },
      },
    },
  },

  preload: {
    build: {
      // A sandboxed preload cannot resolve from node_modules, so bundle
      // everything except `electron` itself.
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(root, 'src/preload/index.ts') },
        // A sandboxed preload also cannot be an ES module, so emit CommonJS
        // with an explicit .cjs extension even though the package is
        // `type: module`.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },

  renderer: {
    root: resolve(root, 'src/renderer'),
    build: {
      rollupOptions: {
        // Two pages, one preload: the fixed-width column and the log window.
        input: {
          index: resolve(root, 'src/renderer/index.html'),
          logs: resolve(root, 'src/renderer/logs.html'),
        },
      },
    },
    resolve: {
      alias: { '@shared': resolve(root, 'src/shared') },
    },
  },
});
