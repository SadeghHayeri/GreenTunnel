// Generates `packages/cli/README.md` from the repository README, so the npm page
// for `green-tunnel` shows the project's own front page.
//
// npm requires the README to sit in the *package* root and reads nothing above it
// (https://docs.npmjs.com/about-package-readme-files), which is why v2 got this for
// free — it published from the repository root — and v3 does not. Rather than keep a
// second README in sync by hand, this rewrites the one at the root and drops the
// result into the package at `prepack` time. The generated file is gitignored: the
// root README is the only one anybody edits.
//
// Every repo-relative link has to become absolute, and that is not cosmetic. npm
// resolves relative paths against `repository.url` *plus* `repository.directory`,
// so `assets/logo.png` would be looked for at `packages/cli/assets/logo.png` and
// every image on the page would be broken.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..');
const SOURCE = join(REPO_ROOT, 'README.md');
const TARGET = join(REPO_ROOT, 'packages', 'cli', 'README.md');

const BRANCH = 'main';
const RAW = `https://raw.githubusercontent.com/SadeghHayeri/GreenTunnel/${BRANCH}/`;
const BLOB = `https://github.com/SadeghHayeri/GreenTunnel/blob/${BRANCH}/`;

// Images have to come from raw.githubusercontent.com; a blob URL serves the GitHub
// page around them, not the bytes.
const IS_IMAGE = /\.(?:png|jpe?g|gif|svg|webp|avif)$/i;

// Already absolute (`https:`, `//`), a mail link, or an in-page anchor.
const IS_ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

const HTML_ATTRIBUTE = /\b(src|href)="([^"]+)"/g;
const MARKDOWN_TARGET = /(\]\()([^)\s]+)(\))/g;

/** Turn a repo-relative link into one that works on npmjs.com. */
function absolute(target) {
  if (IS_ABSOLUTE.test(target)) return target;

  // `./CLAUDE.md#gotchas` — the fragment must not confuse the extension test.
  const cut = target.search(/[#?]/);
  const path = (cut === -1 ? target : target.slice(0, cut)).replace(/^\.?\//, '');
  const suffix = cut === -1 ? '' : target.slice(cut);

  return `${IS_IMAGE.test(path) ? RAW : BLOB}${path}${suffix}`;
}

// Throw rather than write a half-formed page: a missing README here means the file
// moved, and a silent no-op would publish a package with no front page at all.
let readme;
try {
  readme = readFileSync(SOURCE, 'utf8');
} catch (cause) {
  throw new Error(`Cannot read ${SOURCE} — the npm README is generated from it`, { cause });
}

const rewritten = readme
  .replace(HTML_ATTRIBUTE, (_, attribute, target) => `${attribute}="${absolute(target)}"`)
  .replace(MARKDOWN_TARGET, (_, open, target, close) => `${open}${absolute(target)}${close}`);

// An HTML comment, so GitHub and npm both strip it from the rendered page but it is
// the first thing anyone opening the file sees.
const banner =
  '<!-- Generated from the repository README by scripts/npm-readme.js. Edit that one. -->\n\n';

writeFileSync(TARGET, banner + rewritten);

console.warn(`npm README written to packages/cli/README.md (${rewritten.length} bytes)`);
