/** Small helpers the release pipeline's modules share. */

/** Whether a parsed JSON value is an object with string keys, not an array or null. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The environment variable's value.
 *
 * @throws {Error} the variable is unset or empty
 */
export function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`${name} must be set for this step`);
  }

  return value;
}
