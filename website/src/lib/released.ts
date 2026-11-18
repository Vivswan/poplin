import { readFileSync } from "node:fs";
import REPOSITORY_CHANGELOG from "../../../CHANGELOG.md?raw";
import { releases } from "./changelog.ts";

/** One release an install may take: the digest of the manifest of its built files, and its schema. */
interface ReleasePin {
  readonly bundle: string;
  readonly schema: number;
}

/** The newest release an install may take, as `latest.json` tells of it. */
interface Released {
  readonly version: string;
  readonly released: string;
  readonly schema: number;
}

function isPin(entry: unknown): entry is ReleasePin {
  if (typeof entry !== "object" || entry === null) return false;

  const { bundle, schema } = entry as Record<string, unknown>;

  return typeof bundle === "string" && typeof schema === "number" && Number.isSafeInteger(schema) && schema > 0;
}

/**
 * The releases an install may take, by version: the file `POPLIN_RELEASE_PINS` names, as the step before the build wrote it.
 * An entry that lacks one of its two values is left out, so a release with no built files is published nowhere. None when the variable is not set, as in a build on a person's computer.
 */
export function releasePins(): Record<string, ReleasePin> {
  const file = process.env.POPLIN_RELEASE_PINS;
  const written: unknown = file ? JSON.parse(readFileSync(file, "utf8")) : {};

  return Object.fromEntries(Object.entries(written ?? {}).filter((entry): entry is [string, ReleasePin] => isPin(entry[1])));
}

/**
 * The newest released version an install may take, its day, and its schema, from the repository's changelog or from the file `POPLIN_CHANGELOG` names.
 * A version that file does not hold is passed over, so no install is told of a release it would refuse; nothing when no version is left.
 */
export function released(): Released | undefined {
  const override = process.env.POPLIN_CHANGELOG;
  const changelog = override ? readFileSync(override, "utf8") : REPOSITORY_CHANGELOG;
  const pins = releasePins();
  const newest = releases(changelog).find(({ version }) => Object.hasOwn(pins, version));

  return newest === undefined ? undefined : { ...newest, schema: pins[newest.version].schema };
}
