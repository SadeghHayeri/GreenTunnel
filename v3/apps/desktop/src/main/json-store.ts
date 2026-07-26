import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

/**
 * A ~40-line typed JSON store. Enough for two small files, and it avoids taking
 * a dependency (and its ESM/CJS quirks) for something this simple.
 *
 * Writes go to a temp file and are renamed into place, so a crash mid-write
 * cannot leave a truncated settings file behind.
 */
export class JsonStore<T extends object> {
  readonly #file: string;
  readonly #normalize: (raw: unknown) => T;
  #value: T;

  constructor(name: string, normalize: (raw: unknown) => T) {
    this.#file = join(app.getPath('userData'), `${name}.json`);
    this.#normalize = normalize;
    this.#value = normalize(this.#read());
  }

  get value(): T {
    return this.#value;
  }

  set(patch: Partial<T>): T {
    this.#value = this.#normalize({ ...this.#value, ...patch });
    this.#write();
    return this.#value;
  }

  #read(): unknown {
    try {
      return JSON.parse(readFileSync(this.#file, 'utf8')) as unknown;
    } catch {
      // Missing or corrupt — fall back to defaults rather than failing to boot.
      return {};
    }
  }

  #write(): void {
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
      const temporary = `${this.#file}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.#value, null, 2), 'utf8');
      renameSync(temporary, this.#file);
    } catch (error) {
      console.error(`Could not persist ${this.#file}:`, error);
    }
  }
}

/** Small helpers for normalizing values that came off disk. */
export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function asInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function asOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}
