import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SystemProxyError, toError } from '../errors.js';

const run = promisify(execFile);

/**
 * Run a command with an argument array — never a shell string.
 *
 * v2 interpolated network-service names straight into `sh -c "..."`, which is
 * both fragile (names contain spaces) and a command-injection hazard.
 */
export async function exec(file: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await run(file, [...args], { windowsHide: true });
    return stdout;
  } catch (cause) {
    throw new SystemProxyError(`\`${file} ${args.join(' ')}\` failed: ${toError(cause).message}`, {
      cause,
    });
  }
}

/** Same as `exec`, but resolves to `undefined` instead of throwing. */
export async function tryExec(file: string, args: readonly string[]): Promise<string | undefined> {
  try {
    return await exec(file, args);
  } catch {
    return undefined;
  }
}

/** Is `file` on PATH / runnable? */
export async function isAvailable(file: string, args: readonly string[] = ['--version']) {
  return (await tryExec(file, args)) !== undefined;
}

/**
 * Run every task even if some throw, then report the failures together.
 *
 * This is what makes teardown safe. A plain `for (…) await …` loop abandons
 * everything after the first failure, and during *restore* that means leaving
 * services pointed at a port that is about to disappear. Getting an error is
 * fine; getting an error and silently skipping nine services is not.
 */
export async function settle(tasks: Iterable<() => Promise<void>>): Promise<void> {
  const failures: Error[] = [];
  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      failures.push(toError(error));
    }
  }

  const [first] = failures;
  if (!first) return;
  if (failures.length === 1) throw first;
  throw new SystemProxyError(failures.map((failure) => failure.message).join('; '), {
    cause: new AggregateError(failures),
  });
}
