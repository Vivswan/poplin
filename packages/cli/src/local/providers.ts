// The providers the built package carries: one file each in the folder beside the command, loaded when a command that works at a provider runs, and by no other.
//
//   dist/bin.mjs
//   dist/providers/<id>.mjs    exports `installer`, whose `id` is the file's own name
//
// The command names no provider: what it knows of one is what the file's `installer` says.

import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import * as v from "valibot";

import type { Installer } from "../../../core/src/install/installer";

/** What a provider's file ends in. */
const EXTENSION = ".mjs";

/** The members the command reads from a provider before it calls it. Its lists are checked to be lists; what they hold is the provider's own. */
const SHAPE = v.object({
  id: v.string(),
  name: v.string(),
  about: v.string(),
  usage: v.string(),
  options: v.array(v.unknown()),
  tokenHelp: v.object({ install: v.array(v.string()), repair: v.array(v.string()), remove: v.array(v.string()) }),
  token: v.function(),
  read: v.function(),
  placeWords: v.function(),
  facts: v.function(),
  find: v.function(),
  install: v.function(),
  remove: v.function(),
  repair: v.function(),
});

/** The error of a folder that is not there. */
const ABSENT = "ENOENT";

/** Tell a provider from anything else a file may export under its name. */
function isInstaller(value: unknown): value is Installer<unknown, unknown> {
  return v.is(SHAPE, value);
}

/** The files of a folder; none for a folder that is not there. Any other failure to read it is thrown as it is. */
async function filesOf(folder: string): Promise<string[]> {
  try {
    return await readdir(folder);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === ABSENT) return [];

    throw error;
  }
}

async function loadOne(folder: string, file: string): Promise<Installer<unknown, unknown>> {
  const loaded: { readonly installer?: unknown } = await import(pathToFileURL(join(folder, file)).href);
  const { installer } = loaded;
  if (!isInstaller(installer) || installer.id !== basename(file, EXTENSION)) throw new Error(`${file} is not a provider of this poplin build. The package is corrupt: reinstall it.`);

  return installer;
}

/**
 * Load every provider of a folder.
 *
 * @param folder - the folder that holds one built file per provider
 * @returns the providers in the order of their names; none for a folder that is not there. It throws for a folder that cannot be read, and for a file that exports no provider under its own name
 */
export async function loadProviders(folder: string): Promise<readonly Installer<unknown, unknown>[]> {
  const files = await filesOf(folder);

  return Promise.all(
    files
      .filter((file) => file.endsWith(EXTENSION))
      .sort()
      .map((file) => loadOne(folder, file)),
  );
}
