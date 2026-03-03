'use strict';
// CJS interop shim — green-tunnel is now an ES module.
// CommonJS callers must use dynamic import:
//   const gt = await import('green-tunnel');
throw new Error(
  'green-tunnel is an ES module. Use `import` (or dynamic `await import(\'green-tunnel\')`) instead of `require()`.'
);
