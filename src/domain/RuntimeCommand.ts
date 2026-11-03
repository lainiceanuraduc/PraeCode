/**
 * The ACP/bridge launcher Hermes reports for itself.
 *
 * `hermes --print-runtime-command` prints a four-element argv that the extension then executes. That
 * output is data, not a trusted command line: it is validated here before anything is spawned, and the
 * bridge directory is handed over in the environment instead of being pasted into the `-c` source, so
 * no filesystem path is ever interpolated into code.
 */

/** Env var the child reads to find this extension's bridge directory. */
export const BRIDGE_DIR_ENV = 'PRAECODE_BRIDGE_DIR';

export interface RuntimeCommand {
  /** `[interpreter, '-I', '-c', <code>]` — exactly what Hermes printed, code unmodified. */
  argv: [string, string, string, string];
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Validate the printed launcher.
 *
 * `exists` is injected so the rule set is testable without touching the filesystem. Anything
 * unexpected is refused rather than "repaired": a launcher we do not recognise is a configuration
 * problem the user can fix with `radcode.pythonPath`.
 */
export function parseRuntimeCommand(
  value: unknown,
  exists: (candidate: string) => boolean
): RuntimeCommand {
  if (!Array.isArray(value) || value.length !== 4) throw new Error(unsupported);
  const [interpreter, isolate, flag, code] = value;
  if (typeof interpreter !== 'string' || typeof code !== 'string') throw new Error(unsupported);
  // An absolute interpreter path cannot be shadowed by a PATH entry dropped into the workspace.
  if (!interpreter.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(interpreter)) throw new Error(
    `Hermes reported a relative interpreter (${interpreter.slice(0, 80)}); set radcode.pythonPath to an absolute path.`);
  if (CONTROL_CHARS.test(interpreter) || CONTROL_CHARS.test(String(isolate)) || CONTROL_CHARS.test(String(flag)))
    throw new Error(unsupported);
  // Shape first: an argv that is not `-I -c` is not a launcher we understand, whatever it points at.
  if (isolate !== '-I' || flag !== '-c') throw new Error(unsupported);
  if (!exists(interpreter)) throw new Error(`Hermes' interpreter no longer exists at ${interpreter}; set radcode.pythonPath.`);
  if (code.includes('\u0000')) throw new Error(unsupported);
  return { argv: [interpreter, isolate, flag, code] };
}

const unsupported = 'Unsupported Hermes runtime launcher; set radcode.pythonPath to the Hermes Python interpreter.';

/**
 * Prefix that puts the bridge directory on `sys.path` without embedding it in the code string.
 *
 * A path is attacker-influenced data (a workspace can be named anything), so it travels as an
 * environment variable and the source only names that variable.
 */
export function bridgePrelude(): string {
  return `import os, sys; sys.path.insert(0, os.environ[${JSON.stringify(BRIDGE_DIR_ENV)}]); `;
}
