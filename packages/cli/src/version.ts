import { readFileSync } from 'node:fs';

interface PackageManifest {
  readonly version?: string;
}

/** Read from the manifest next to `dist/` so there is one source of truth. */
export const VERSION: string = readManifestVersion();

function readManifestVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return (JSON.parse(raw) as PackageManifest).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
